import { AuditActorType, GiveawayStatus, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  createGiveawayDrawSeed,
  createGiveawayInputSchema,
  effectiveGiveawayStatus,
  GIVEAWAY_DRAW_PROTOCOL_VERSION,
  isGiveawayLabEnabled,
  parseGiveawayTerms,
} from "@/lib/giveaway-lab";
import { GIVEAWAY_FUNDING_GRACE_SECONDS } from "@/lib/giveaway-prize-shared";
import { reconcileGiveawayPrize } from "@/lib/giveaway-prize";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export async function GET(request: Request) {
  if (!isGiveawayLabEnabled()) return disabledResponse();

  const guard = await requireCreator(request, prisma, { allowTelegramMiniApp: true });
  if (!guard.ok) return guard.response;

  const giveaways = await prisma.giveaway.findMany({
    include: {
      _count: { select: { entries: true } },
      prizeLink: {
        select: {
          fundingAddress: true,
          fundingOutputIndex: true,
          fundingTxId: true,
          amountSompi: true,
          claimPublicKey: true,
          claimTxId: true,
          createdAt: true,
          feeSompi: true,
          id: true,
          linkKey: true,
          redeemScriptHex: true,
          refundLockTime: true,
          refundPublicKey: true,
          refundTxId: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    where: { creatorId: guard.creator.id },
  });

  const reconciledGiveaways = await Promise.all(
    giveaways.map(async (giveaway) => {
      try {
        return await reconcileGiveawayPrize(giveaway);
      } catch {
        return giveaway;
      }
    }),
  );

  return apiJson({
    giveaways: reconciledGiveaways.map((giveaway) => ({
      amountKas: formatSompiToKaspa(giveaway.amountSompi),
      closesAt: giveaway.closesAt.toISOString(),
      createdAt: giveaway.createdAt.toISOString(),
      entryWindowSeconds: giveaway.entryWindowSeconds,
      fundingExpiresAt: giveaway.prizeLink
        ? new Date(
            giveaway.prizeLink.createdAt.getTime() + GIVEAWAY_FUNDING_GRACE_SECONDS * 1000,
          ).toISOString()
        : null,
      description: giveaway.description,
      drawCommitment: giveaway.drawCommitment,
      drawProtocol: {
        entropyBlockBlueScore: giveaway.entropyBlockBlueScore?.toString() ?? null,
        entropyBlockHash: giveaway.entropyBlockHash,
        entropyTargetBlueScore: giveaway.entropyTargetBlueScore?.toString() ?? null,
        entriesFrozenAt: giveaway.entriesFrozenAt?.toISOString() ?? null,
        entriesRoot: giveaway.entriesRoot,
        entryCount: giveaway.entryCountAtDraw,
        version: giveaway.drawProtocolVersion,
      },
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
      winnerClaim: {
        expiresAt: giveaway.winnerClaimExpiresAt?.toISOString() ?? null,
        preparedAt: giveaway.prizeClaimPreparedAt?.toISOString() ?? null,
        preparedTransactionId: giveaway.prizeClaimTransactionId,
        windowSeconds: giveaway.winnerClaimWindowSeconds,
      },
      prize: giveaway.prizeLink
        ? {
            funded: giveaway.prizeLink.fundingTxId !== null,
            amountSompi: giveaway.prizeLink.amountSompi.toString(),
            claimPublicKey: giveaway.prizeLink.claimPublicKey,
            claimTxId: giveaway.prizeLink.claimTxId,
            feeSompi: giveaway.prizeLink.feeSompi.toString(),
            fundingAddress: giveaway.prizeLink.fundingAddress,
            fundingOutputIndex: giveaway.prizeLink.fundingOutputIndex,
            fundingTxId: giveaway.prizeLink.fundingTxId,
            linkKey: giveaway.prizeLink.linkKey,
            redeemScriptHex: giveaway.prizeLink.redeemScriptHex,
            refundLockTime: giveaway.prizeLink.refundLockTime,
            refundPublicKey: giveaway.prizeLink.refundPublicKey,
            status: giveaway.prizeLink.status,
          }
        : null,
      publicId: giveaway.publicId,
      publicUrl: `/toccata-lab/giveaway/${giveaway.publicId}`,
      status: effectiveGiveawayStatus(
        giveaway.status,
        giveaway.closesAt,
        new Date(),
        giveaway.openedAt,
      ),
      title: giveaway.title,
      winnerAddress: giveaway.winnerAddress,
    })),
  });
}

export async function POST(request: Request) {
  if (!isGiveawayLabEnabled()) return disabledResponse();

  const guard = await requireCreator(request, prisma, { allowTelegramMiniApp: true });
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
  let validatedPrizeLink: null | {
    amountSompi: bigint;
    claimPublicKey: string;
    claimTxId: null | string;
    createdAt: Date;
    feeSompi: bigint;
    fundingAddress: string;
    fundingOutputIndex: null | number;
    fundingTxId: null | string;
    linkKey: string;
    redeemScriptHex: string;
    refundLockTime: string;
    refundPublicKey: string;
    status: string;
  } = null;
  if (prizeLinkKey) {
    const prizeLink = await prisma.claimableLink.findUnique({
      select: {
        amountSompi: true,
        claimPublicKey: true,
        claimTxId: true,
        creatorId: true,
        createdAt: true,
        deletedAt: true,
        feeSompi: true,
        fundingAddress: true,
        fundingOutputIndex: true,
        fundingTxId: true,
        linkKey: true,
        prizeForGiveaway: { select: { publicId: true } },
        redeemScriptHex: true,
        refundLockTime: true,
        refundPublicKey: true,
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
    validatedPrizeLink = prizeLink;
  }

  const draw = createGiveawayDrawSeed();
  const insertGiveaway = () =>
    prisma.giveaway.create({
      data: {
        amountSompi: terms.amountSompi,
        closesAt: terms.closesAt,
        creatorId: guard.creator.id,
        description: terms.description,
        drawCommitment: draw.commitment,
        drawProtocolVersion: GIVEAWAY_DRAW_PROTOCOL_VERSION,
        drawSeedHex: draw.seedHex,
        entryWindowSeconds: terms.entryWindowSeconds,
        openedAt: prizeLinkKey ? null : new Date(),
        prizeLinkKey,
        status: GiveawayStatus.OPEN,
        title: terms.title,
        winnerClaimWindowSeconds: terms.winnerClaimWindowSeconds,
      },
    });
  let giveaway: Awaited<ReturnType<typeof insertGiveaway>>;
  try {
    giveaway = await insertGiveaway();
  } catch (error) {
    if (prizeLinkKey && isPrismaUniqueConstraintError(error, ["prizeLinkKey"])) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "That prize link already backs another giveaway.",
        409,
      );
    }
    throw error;
  }

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
        createdAt: giveaway.createdAt.toISOString(),
        entryWindowSeconds: terms.entryWindowSeconds,
        fundingExpiresAt: validatedPrizeLink
          ? new Date(
              validatedPrizeLink.createdAt.getTime() + GIVEAWAY_FUNDING_GRACE_SECONDS * 1000,
            ).toISOString()
          : null,
        description: giveaway.description,
        drawCommitment: giveaway.drawCommitment,
        drawProtocol: {
          entropyBlockBlueScore: null,
          entropyBlockHash: null,
          entropyTargetBlueScore: null,
          entriesFrozenAt: null,
          entriesRoot: null,
          entryCount: null,
          version: giveaway.drawProtocolVersion,
        },
        entryCount: 0,
        prize: validatedPrizeLink
          ? {
              amountSompi: validatedPrizeLink.amountSompi.toString(),
              claimPublicKey: validatedPrizeLink.claimPublicKey,
              claimTxId: validatedPrizeLink.claimTxId,
              feeSompi: validatedPrizeLink.feeSompi.toString(),
              funded: validatedPrizeLink.fundingTxId !== null,
              fundingAddress: validatedPrizeLink.fundingAddress,
              fundingOutputIndex: validatedPrizeLink.fundingOutputIndex,
              fundingTxId: validatedPrizeLink.fundingTxId,
              linkKey: validatedPrizeLink.linkKey,
              redeemScriptHex: validatedPrizeLink.redeemScriptHex,
              refundLockTime: validatedPrizeLink.refundLockTime,
              refundPublicKey: validatedPrizeLink.refundPublicKey,
              status: validatedPrizeLink.status,
            }
          : null,
        publicId: giveaway.publicId,
        publicUrl: `/toccata-lab/giveaway/${giveaway.publicId}`,
        status: prizeLinkKey ? "PENDING_FUNDING" : GiveawayStatus.OPEN,
        title: giveaway.title,
        winnerClaim: {
          expiresAt: null,
          preparedAt: null,
          preparedTransactionId: null,
          windowSeconds: giveaway.winnerClaimWindowSeconds,
        },
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
