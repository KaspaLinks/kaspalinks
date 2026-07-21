import { AuditActorType, GiveawayStatus, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  createGiveawayDrawSeed,
  createGiveawayInputSchema,
  effectiveGiveawayStatus,
  isGiveawayLabEnabled,
  parseGiveawayTerms,
} from "@/lib/giveaway-lab";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export async function GET(request: Request) {
  if (!isGiveawayLabEnabled()) return disabledResponse();

  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const giveaways = await prisma.giveaway.findMany({
    include: {
      _count: { select: { entries: true } },
      prizeLink: {
        select: {
          fundingAddress: true,
          fundingOutputIndex: true,
          fundingTxId: true,
          linkKey: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    where: { creatorId: guard.creator.id },
  });

  return apiJson({
    giveaways: giveaways.map((giveaway) => ({
      amountKas: formatSompiToKaspa(giveaway.amountSompi),
      closesAt: giveaway.closesAt.toISOString(),
      createdAt: giveaway.createdAt.toISOString(),
      description: giveaway.description,
      drawCommitment: giveaway.drawCommitment,
      drawProof:
        giveaway.status === GiveawayStatus.DRAWN || giveaway.status === GiveawayStatus.NO_ENTRIES
          ? {
              digest: giveaway.drawDigest,
              entryCount: giveaway.entryCountAtDraw,
              seed: giveaway.drawSeedHex,
              winnerIndex: giveaway.winnerIndex,
            }
          : null,
      entryCount: giveaway._count.entries,
      prize: giveaway.prizeLink
        ? {
            funded: giveaway.prizeLink.fundingTxId !== null,
            fundingAddress: giveaway.prizeLink.fundingAddress,
            fundingTxId: giveaway.prizeLink.fundingTxId,
            linkKey: giveaway.prizeLink.linkKey,
            status: giveaway.prizeLink.status,
          }
        : null,
      publicId: giveaway.publicId,
      publicUrl: `/toccata-lab/giveaway/${giveaway.publicId}`,
      status: effectiveGiveawayStatus(giveaway.status, giveaway.closesAt),
      title: giveaway.title,
      winnerAddress: giveaway.winnerAddress,
    })),
  });
}

export async function POST(request: Request) {
  if (!isGiveawayLabEnabled()) return disabledResponse();

  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, guard.creator.id);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = createGiveawayInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid giveaway.",
      400,
    );
  }

  let terms: ReturnType<typeof parseGiveawayTerms>;
  try {
    terms = parseGiveawayTerms(parsed.data);
  } catch (error) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      error instanceof Error ? error.message : "Invalid giveaway.",
      400,
    );
  }

  // An optional prize escrow must belong to this creator, must not already
  // back another giveaway, and must still be spendable.
  const prizeLinkKey = parsed.data.prizeLinkKey?.trim() ?? null;
  if (prizeLinkKey) {
    const prizeLink = await prisma.claimableLink.findUnique({
      select: {
        amountSompi: true,
        creatorId: true,
        deletedAt: true,
        feeSompi: true,
        prizeForGiveaway: { select: { publicId: true } },
        status: true,
      },
      where: { linkKey: prizeLinkKey },
    });
    if (!prizeLink || prizeLink.creatorId !== guard.creator.id || prizeLink.deletedAt) {
      return apiError(ErrorCodes.NOT_FOUND, "Prize link was not found.", 404);
    }
    if (prizeLink.prizeForGiveaway) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "That prize link already backs another giveaway.",
        409,
      );
    }
    if (["claimed", "refunded", "spent_unknown"].includes(prizeLink.status)) {
      return apiError(ErrorCodes.INVALID_STATE, "That prize link is already closed.", 409);
    }
    // The entry page will advertise this amount, so it has to be the real one.
    if (prizeLink.amountSompi - prizeLink.feeSompi !== terms.amountSompi) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "The prize link does not hold the advertised reward amount.",
        400,
      );
    }
  }

  const draw = createGiveawayDrawSeed();
  const giveaway = await prisma.giveaway.create({
    data: {
      amountSompi: terms.amountSompi,
      closesAt: terms.closesAt,
      creatorId: guard.creator.id,
      description: terms.description,
      drawCommitment: draw.commitment,
      drawSeedHex: draw.seedHex,
      prizeLinkKey,
      status: GiveawayStatus.OPEN,
      title: terms.title,
    },
  });

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "giveaway.created",
    ipHash: guard.ipHash,
    metadata: {
      amountSompi: terms.amountSompi.toString(),
      closesAt: terms.closesAt.toISOString(),
      publicId: giveaway.publicId,
    },
  });

  return apiJson(
    {
      giveaway: {
        amountKas: terms.amountKas,
        closesAt: terms.closesAt.toISOString(),
        description: giveaway.description,
        drawCommitment: giveaway.drawCommitment,
        entryCount: 0,
        publicId: giveaway.publicId,
        publicUrl: `/toccata-lab/giveaway/${giveaway.publicId}`,
        status: GiveawayStatus.OPEN,
        title: giveaway.title,
      },
    },
    201,
  );
}

function disabledResponse() {
  return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "POST"]);
export { methodNotAllowed as DELETE, methodNotAllowed as PATCH, methodNotAllowed as PUT };
