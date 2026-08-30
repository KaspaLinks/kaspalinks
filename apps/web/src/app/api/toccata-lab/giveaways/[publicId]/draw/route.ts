import { AuditActorType, GiveawayStatus, Prisma, prisma } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import {
  GIVEAWAY_ENTROPY_FUTURE_BLUE_SCORE_OFFSET,
  readConfirmedGiveawayChainEntropy,
  readCurrentMainnetVirtualBlueScore,
} from "@/lib/giveaway-chain-entropy";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  computeEmptyGiveawayDrawDigest,
  computeGiveawayDraw,
  computeGiveawayDrawV2,
  computeGiveawayFreezeCommitment,
  freezeGiveawayEntries,
  giveawayPublicIdSchema,
  isGiveawayLabEnabled,
} from "@/lib/giveaway-lab";
import { reconcileGiveawayPrize } from "@/lib/giveaway-prize";
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

  const candidate = await prisma.giveaway.findUnique({
    include: { prizeLink: true },
    where: { publicId: parsedId.data },
  });
  if (!candidate) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  if (candidate.prizeLink) {
    let reconciled: typeof candidate;
    try {
      reconciled = await reconcileGiveawayPrize(candidate, new Date(), { force: true });
    } catch {
      return apiError(
        ErrorCodes.SERVER_ERROR,
        "The parked prize could not be verified on-chain. Try again shortly.",
        503,
      );
    }
    if (["claimed", "refunded", "spent_unknown"].includes(reconciled.prizeLink?.status ?? "")) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "The giveaway cannot draw a winner because its parked prize is no longer available.",
        409,
      );
    }
  }

  if (candidate.drawProtocolVersion >= 2) {
    return drawVerifiableGiveaway(parsedId.data, ipHash);
  }
  return drawLegacyGiveaway(parsedId.data, ipHash);
}

async function drawVerifiableGiveaway(publicId: string, ipHash: string) {
  let giveaway = await prisma.giveaway.findUnique({ where: { publicId } });
  if (!giveaway) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  if (giveaway.status === GiveawayStatus.DRAWN || giveaway.status === GiveawayStatus.NO_ENTRIES) {
    return apiJson({ giveaway: serializeDrawOutcome(giveaway) });
  }
  if (giveaway.status !== GiveawayStatus.OPEN) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Giveaway cannot be drawn in its current state.",
      409,
    );
  }
  if (giveaway.openedAt === null) {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway prize funding is not confirmed yet.", 409);
  }
  if (giveaway.closesAt.getTime() > Date.now()) {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway entries are still open.", 409);
  }

  if (!giveaway.entriesFrozenAt) {
    let currentBlueScore: bigint;
    try {
      currentBlueScore = await readCurrentMainnetVirtualBlueScore();
    } catch (error) {
      return apiError(
        ErrorCodes.SERVER_ERROR,
        error instanceof Error ? error.message : "Kaspa chain state is unavailable.",
        503,
      );
    }
    const entropyTargetBlueScore = currentBlueScore + GIVEAWAY_ENTROPY_FUTURE_BLUE_SCORE_OFFSET;

    let freezeOutcome:
      | { giveaway: typeof giveaway; kind: "empty" | "frozen" }
      | { kind: "conflict" | "early" | "missing" | "pending_funding" | "terminal" };
    try {
      freezeOutcome = await prisma.$transaction(
        async (tx) => {
          const current = await tx.giveaway.findUnique({ where: { publicId } });
          if (!current) return { kind: "missing" as const };
          if (current.status !== GiveawayStatus.OPEN) return { kind: "terminal" as const };
          if (current.openedAt === null) return { kind: "pending_funding" as const };
          if (current.closesAt.getTime() > Date.now()) return { kind: "early" as const };
          if (current.entriesFrozenAt) {
            return { giveaway: current, kind: "frozen" as const };
          }

          const entries = await tx.giveawayEntry.findMany({
            select: { address: true, id: true },
            where: { giveawayId: current.id },
          });
          const frozen = freezeGiveawayEntries(entries);
          const entriesFrozenAt = new Date();
          const freezeCommitment = computeGiveawayFreezeCommitment({
            closesAt: current.closesAt,
            drawCommitment: current.drawCommitment,
            entriesRoot: frozen.entriesRoot,
            entryCount: entries.length,
            entropyTargetBlueScore,
            publicId: current.publicId,
          });
          const empty = entries.length === 0;
          const updated = await tx.giveaway.updateMany({
            data: {
              drawDigest: empty ? freezeCommitment : null,
              drawnAt: empty ? entriesFrozenAt : null,
              entriesFrozenAt,
              entriesRoot: frozen.entriesRoot,
              entryCountAtDraw: entries.length,
              entropyTargetBlueScore,
              status: empty ? GiveawayStatus.NO_ENTRIES : GiveawayStatus.OPEN,
            },
            where: { entriesFrozenAt: null, id: current.id, status: GiveawayStatus.OPEN },
          });
          if (updated.count !== 1) return { kind: "conflict" as const };
          return {
            giveaway: {
              ...current,
              drawDigest: empty ? freezeCommitment : null,
              drawnAt: empty ? entriesFrozenAt : null,
              entriesFrozenAt,
              entriesRoot: frozen.entriesRoot,
              entryCountAtDraw: entries.length,
              entropyTargetBlueScore,
              status: empty ? GiveawayStatus.NO_ENTRIES : GiveawayStatus.OPEN,
            },
            kind: empty ? ("empty" as const) : ("frozen" as const),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (!isPrismaTransactionConflict(error)) throw error;
      freezeOutcome = { kind: "conflict" };
    }

    if (freezeOutcome.kind === "missing") {
      return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
    }
    if (freezeOutcome.kind === "early") {
      return apiError(ErrorCodes.INVALID_STATE, "Giveaway entries are still open.", 409);
    }
    if (freezeOutcome.kind === "pending_funding") {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Giveaway prize funding is not confirmed yet.",
        409,
      );
    }
    if (freezeOutcome.kind === "terminal") {
      const terminalGiveaway = await prisma.giveaway.findUnique({ where: { publicId } });
      return terminalGiveaway
        ? apiJson({ giveaway: serializeDrawOutcome(terminalGiveaway) })
        : apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
    }
    if (freezeOutcome.kind === "conflict") {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Giveaway entries are being frozen. Please retry shortly.",
        409,
      );
    }
    if (!("giveaway" in freezeOutcome)) {
      return apiError(ErrorCodes.INVALID_STATE, "Giveaway could not be frozen.", 409);
    }

    giveaway = freezeOutcome.giveaway;
    await writeAuditLog(prisma, {
      actorType: AuditActorType.PUBLIC,
      creatorId: giveaway.creatorId,
      event:
        freezeOutcome.kind === "empty"
          ? "giveaway.closed_without_entries"
          : "giveaway.entries_frozen",
      ipHash,
      metadata: {
        entriesRoot: giveaway.entriesRoot,
        entryCount: giveaway.entryCountAtDraw,
        entropyTargetBlueScore: giveaway.entropyTargetBlueScore?.toString() ?? null,
        publicId: giveaway.publicId,
      },
    });
    if (freezeOutcome.kind === "empty") {
      return apiJson({ giveaway: serializeDrawOutcome(giveaway) });
    }

    return apiJson({ giveaway: serializeDrawOutcome(giveaway) }, 202);
  }

  if (
    !giveaway.entriesRoot ||
    giveaway.entryCountAtDraw === null ||
    giveaway.entropyTargetBlueScore === null
  ) {
    return apiError(ErrorCodes.SERVER_ERROR, "Giveaway freeze proof is incomplete.", 500);
  }

  let entropy: Awaited<ReturnType<typeof readConfirmedGiveawayChainEntropy>>;
  try {
    entropy = await readConfirmedGiveawayChainEntropy(giveaway.entropyTargetBlueScore);
  } catch (error) {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      error instanceof Error ? error.message : "Kaspa chain entropy is unavailable.",
      503,
    );
  }
  if (!entropy.ready) {
    return apiJson(
      {
        giveaway: serializeDrawOutcome(giveaway),
        waitingForEntropy: {
          currentBlueScore: entropy.currentBlueScore.toString(),
          requiredBlueScore: entropy.requiredBlueScore.toString(),
        },
      },
      202,
    );
  }

  let drawOutcome:
    | { giveaway: typeof giveaway; kind: "drawn" | "existing" }
    | { kind: "conflict" | "missing" | "terminal" };
  try {
    drawOutcome = await prisma.$transaction(
      async (tx) => {
        const current = await tx.giveaway.findUnique({ where: { publicId } });
        if (!current) return { kind: "missing" as const };
        if (current.status === GiveawayStatus.DRAWN) {
          return { giveaway: current, kind: "existing" as const };
        }
        if (
          current.status !== GiveawayStatus.OPEN ||
          !current.entriesRoot ||
          current.entropyTargetBlueScore === null ||
          current.entryCountAtDraw === null
        ) {
          return { kind: "terminal" as const };
        }

        const entries = await tx.giveawayEntry.findMany({
          select: { address: true, id: true },
          where: { giveawayId: current.id },
        });
        if (entries.length !== current.entryCountAtDraw) {
          throw new Error("Giveaway participant count no longer matches the frozen proof.");
        }
        const draw = computeGiveawayDrawV2({
          closesAt: current.closesAt,
          drawCommitment: current.drawCommitment,
          entries,
          entriesRoot: current.entriesRoot,
          entropyBlockBlueScore: entropy.blockBlueScore,
          entropyBlockHash: entropy.blockHash,
          entropyTargetBlueScore: current.entropyTargetBlueScore,
          publicId: current.publicId,
          seedHex: current.drawSeedHex,
        });
        const drawnAt = new Date();
        const winnerClaimWindowSeconds = normalizeWinnerClaimWindowSeconds(
          current.winnerClaimWindowSeconds,
        );
        const winnerClaimExpiresAt = new Date(drawnAt.getTime() + winnerClaimWindowSeconds * 1_000);
        const updated = await tx.giveaway.updateMany({
          data: {
            drawDigest: draw.digest,
            drawnAt,
            entropyBlockBlueScore: entropy.blockBlueScore,
            entropyBlockHash: entropy.blockHash,
            status: GiveawayStatus.DRAWN,
            winnerAddress: draw.winnerAddress,
            winnerClaimExpiresAt,
            winnerEntryId: draw.winnerEntryId,
            winnerIndex: draw.winnerIndex,
          },
          where: {
            entriesRoot: current.entriesRoot,
            id: current.id,
            status: GiveawayStatus.OPEN,
          },
        });
        if (updated.count !== 1) return { kind: "conflict" as const };
        return {
          giveaway: {
            ...current,
            drawDigest: draw.digest,
            drawnAt,
            entropyBlockBlueScore: entropy.blockBlueScore,
            entropyBlockHash: entropy.blockHash,
            status: GiveawayStatus.DRAWN,
            winnerAddress: draw.winnerAddress,
            winnerClaimExpiresAt,
            winnerEntryId: draw.winnerEntryId,
            winnerIndex: draw.winnerIndex,
          },
          kind: "drawn" as const,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (!isPrismaTransactionConflict(error)) throw error;
    drawOutcome = { kind: "conflict" };
  }

  if (drawOutcome.kind === "missing") {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  }
  if (drawOutcome.kind === "terminal") {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Giveaway cannot be drawn in its current state.",
      409,
    );
  }
  if (drawOutcome.kind === "conflict") {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway draw is already being processed.", 409);
  }
  if (!("giveaway" in drawOutcome)) {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway draw could not be completed.", 409);
  }

  if (drawOutcome.kind === "drawn") {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.PUBLIC,
      creatorId: drawOutcome.giveaway.creatorId,
      event: "giveaway.drawn_v2",
      ipHash,
      metadata: {
        entropyBlockBlueScore: entropy.blockBlueScore.toString(),
        entropyBlockHash: entropy.blockHash,
        entryCount: drawOutcome.giveaway.entryCountAtDraw,
        publicId: drawOutcome.giveaway.publicId,
        winnerIndex: drawOutcome.giveaway.winnerIndex,
      },
    });
  }

  return apiJson({ giveaway: serializeDrawOutcome(drawOutcome.giveaway) });
}

async function drawLegacyGiveaway(publicId: string, ipHash: string) {
  const runDrawTransaction = () =>
    prisma.$transaction(
      async (tx) => {
        const giveaway = await tx.giveaway.findUnique({ where: { publicId } });
        if (!giveaway) return { kind: "missing" as const };
        if (giveaway.status === GiveawayStatus.DRAWN) {
          return { giveaway, kind: "existing" as const };
        }
        if (giveaway.status !== GiveawayStatus.OPEN) {
          return { giveaway, kind: "terminal" as const };
        }
        if (giveaway.openedAt === null) {
          return { giveaway, kind: "pending_funding" as const };
        }
        if (giveaway.closesAt.getTime() > Date.now()) {
          return { giveaway, kind: "early" as const };
        }

        const entries = await tx.giveawayEntry.findMany({
          select: { address: true, id: true },
          where: { giveawayId: giveaway.id },
        });
        const now = new Date();
        const winnerClaimWindowSeconds = normalizeWinnerClaimWindowSeconds(
          giveaway.winnerClaimWindowSeconds,
        );
        const winnerClaimExpiresAt = new Date(now.getTime() + winnerClaimWindowSeconds * 1_000);
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
              winnerClaimExpiresAt,
            },
            where: { id: giveaway.id, status: GiveawayStatus.OPEN },
          });
          if (updated.count !== 1) return { giveaway, kind: "conflict" as const };
          return {
            giveaway: {
              ...giveaway,
              drawDigest,
              drawnAt: now,
              entryCountAtDraw: 0,
              status: GiveawayStatus.NO_ENTRIES,
              winnerClaimExpiresAt,
            },
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
            winnerClaimExpiresAt,
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
            status: GiveawayStatus.DRAWN,
            winnerAddress: draw.winnerAddress,
            winnerClaimExpiresAt,
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
  if (outcome.kind === "pending_funding") {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway prize funding is not confirmed yet.", 409);
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

  return apiJson({ giveaway: serializeDrawOutcome(outcome.giveaway) });
}

function serializeDrawOutcome(giveaway: {
  closesAt: Date;
  drawCommitment: string;
  drawDigest: null | string;
  drawProtocolVersion: number;
  drawSeedHex: string;
  entriesFrozenAt: Date | null;
  entriesRoot: null | string;
  entryCountAtDraw: null | number;
  entropyBlockBlueScore: bigint | null;
  entropyBlockHash: null | string;
  entropyTargetBlueScore: bigint | null;
  publicId: string;
  status: GiveawayStatus;
  winnerAddress: null | string;
  winnerClaimExpiresAt: Date | null;
  winnerIndex: null | number;
}) {
  const effectiveStatus = giveaway.status === GiveawayStatus.OPEN ? "CLOSED" : giveaway.status;
  const freezeCommitment =
    giveaway.entriesRoot &&
    giveaway.entryCountAtDraw !== null &&
    giveaway.entropyTargetBlueScore !== null
      ? computeGiveawayFreezeCommitment({
          closesAt: giveaway.closesAt,
          drawCommitment: giveaway.drawCommitment,
          entriesRoot: giveaway.entriesRoot,
          entryCount: giveaway.entryCountAtDraw,
          entropyTargetBlueScore: giveaway.entropyTargetBlueScore,
          publicId: giveaway.publicId,
        })
      : null;

  return {
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
    drawProtocol: {
      entropyBlockBlueScore: giveaway.entropyBlockBlueScore?.toString() ?? null,
      entropyBlockHash: giveaway.entropyBlockHash,
      entropyTargetBlueScore: giveaway.entropyTargetBlueScore?.toString() ?? null,
      entriesFrozenAt: giveaway.entriesFrozenAt?.toISOString() ?? null,
      entriesRoot: giveaway.entriesRoot,
      entryCount: giveaway.entryCountAtDraw,
      freezeCommitment,
      version: giveaway.drawProtocolVersion,
    },
    publicId: giveaway.publicId,
    status: effectiveStatus,
    winnerAddress: giveaway.winnerAddress,
    winnerClaimExpiresAt: giveaway.winnerClaimExpiresAt?.toISOString() ?? null,
  };
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

function isPrismaTransactionConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function normalizeWinnerClaimWindowSeconds(value: null | number): number {
  return Number.isInteger(value) && value !== null && value >= 60 ? value : 24 * 60 * 60;
}

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
