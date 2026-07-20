import { AuditActorType, GiveawayStatus, Prisma, prisma } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  computeEmptyGiveawayDrawDigest,
  computeGiveawayDraw,
  giveawayPublicIdSchema,
  isGiveawayLabEnabled,
} from "@/lib/giveaway-lab";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, ipHash);
  if (!limited.allowed) return limited.response;

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const runDrawTransaction = () =>
    prisma.$transaction(
      async (tx) => {
        const giveaway = await tx.giveaway.findUnique({ where: { publicId: parsedId.data } });
        if (!giveaway) return { kind: "missing" as const };
        if (giveaway.status === GiveawayStatus.DRAWN) {
          return { giveaway, kind: "existing" as const };
        }
        if (giveaway.status !== GiveawayStatus.OPEN) {
          return { giveaway, kind: "terminal" as const };
        }
        if (giveaway.closesAt.getTime() > Date.now()) {
          return { giveaway, kind: "early" as const };
        }

        const entries = await tx.giveawayEntry.findMany({
          select: { address: true, id: true },
          where: { giveawayId: giveaway.id },
        });
        const now = new Date();
        if (entries.length === 0) {
          const drawDigest = computeEmptyGiveawayDrawDigest({
            closesAt: giveaway.closesAt,
            publicId: giveaway.publicId,
            seedHex: giveaway.drawSeedHex,
          });
          const updated = await tx.giveaway.updateMany({
            data: {
              drawDigest,
              drawnAt: now,
              entryCountAtDraw: 0,
              status: GiveawayStatus.NO_ENTRIES,
            },
            where: { id: giveaway.id, status: GiveawayStatus.OPEN },
          });
          if (updated.count !== 1) return { giveaway, kind: "conflict" as const };
          return {
            giveaway: { ...giveaway, drawDigest, drawnAt: now, entryCountAtDraw: 0 },
            kind: "empty" as const,
          };
        }

        const draw = computeGiveawayDraw({
          closesAt: giveaway.closesAt,
          entries,
          publicId: giveaway.publicId,
          seedHex: giveaway.drawSeedHex,
        });
        const updated = await tx.giveaway.updateMany({
          data: {
            drawDigest: draw.digest,
            drawnAt: now,
            entryCountAtDraw: entries.length,
            status: GiveawayStatus.DRAWN,
            winnerAddress: draw.winnerAddress,
            winnerEntryId: draw.winnerEntryId,
            winnerIndex: draw.winnerIndex,
          },
          where: { id: giveaway.id, status: GiveawayStatus.OPEN },
        });
        if (updated.count !== 1) return { giveaway, kind: "conflict" as const };
        return {
          giveaway: {
            ...giveaway,
            drawDigest: draw.digest,
            drawnAt: now,
            entryCountAtDraw: entries.length,
            winnerAddress: draw.winnerAddress,
            winnerIndex: draw.winnerIndex,
          },
          kind: "drawn" as const,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

  let outcome: Awaited<ReturnType<typeof runDrawTransaction>> | { kind: "conflict" };
  try {
    outcome = await runDrawTransaction();
  } catch (error) {
    if (!isPrismaTransactionConflict(error)) throw error;
    outcome = { kind: "conflict" };
  }

  if (outcome.kind === "missing") {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  }
  if (outcome.kind === "early") {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway entries are still open.", 409);
  }
  if (outcome.kind === "conflict") {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway draw is already being processed.", 409);
  }
  if (outcome.kind === "terminal") {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Giveaway cannot be drawn in its current state.",
      409,
    );
  }

  if (outcome.kind !== "existing") {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.PUBLIC,
      creatorId: outcome.giveaway.creatorId,
      event: outcome.kind === "empty" ? "giveaway.closed_without_entries" : "giveaway.drawn",
      ipHash,
      metadata: {
        entryCount: outcome.giveaway.entryCountAtDraw,
        publicId: outcome.giveaway.publicId,
        winnerIndex: outcome.giveaway.winnerIndex,
      },
    });
  }

  return apiJson({
    giveaway: {
      drawCommitment: outcome.giveaway.drawCommitment,
      drawProof: {
        digest: outcome.giveaway.drawDigest,
        entryCount: outcome.giveaway.entryCountAtDraw,
        seed: outcome.giveaway.drawSeedHex,
        winnerIndex: outcome.giveaway.winnerIndex,
      },
      publicId: outcome.giveaway.publicId,
      status: outcome.kind === "empty" ? GiveawayStatus.NO_ENTRIES : GiveawayStatus.DRAWN,
      winnerAddress: outcome.giveaway.winnerAddress,
    },
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

function isPrismaTransactionConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
