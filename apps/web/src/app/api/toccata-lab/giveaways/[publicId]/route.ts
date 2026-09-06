import { AuditActorType, GiveawayStatus, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  computeEmptyGiveawayDrawDigest,
  computeGiveawayDraw,
  computeGiveawayDrawV2,
  computeGiveawayFreezeCommitment,
  freezeGiveawayEntries,
  effectiveGiveawayStatus,
  giveawayPublicIdSchema,
  isGiveawayLabEnabled,
  verifyGiveawaySeed,
} from "@/lib/giveaway-lab";
import { reconcileGiveawayPrize } from "@/lib/giveaway-prize";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export async function GET(_request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const giveaway = await prisma.giveaway.findUnique({
    include: {
      _count: { select: { entries: true } },
      entries: { orderBy: { createdAt: "asc" }, select: { address: true, id: true } },
      prizeLink: {
        select: {
          amountSompi: true,
          claimTxId: true,
          createdAt: true,
          feeSompi: true,
          fundingAddress: true,
          fundingOutputIndex: true,
          fundingTxId: true,
          id: true,
          linkKey: true,
          redeemScriptHex: true,
          refundLockTime: true,
          refundTxId: true,
          status: true,
        },
      },
    },
    where: { publicId: parsedId.data },
  });
  if (!giveaway) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  let reconciled = giveaway;
  try {
    reconciled = await reconcileGiveawayPrize(giveaway);
  } catch {
    // Public reads remain available during a temporary indexer outage. An
    // unfunded prize simply stays pending until the next successful refresh.
  }

  const drawn = reconciled.status === GiveawayStatus.DRAWN;
  let proof: ReturnType<typeof computeGiveawayDraw> | null = null;
  let freezeCommitment: null | string = null;
  let frozenEntryHashes: string[] = [];
  if (giveaway.entriesRoot) {
    try {
      const frozen = freezeGiveawayEntries(giveaway.entries);
      if (
        frozen.entriesRoot !== giveaway.entriesRoot ||
        giveaway.entryCountAtDraw !== giveaway.entries.length ||
        giveaway.entropyTargetBlueScore === null
      ) {
        throw new Error("Frozen giveaway manifest is inconsistent.");
      }
      frozenEntryHashes = frozen.entryHashes;
      freezeCommitment = computeGiveawayFreezeCommitment({
        closesAt: giveaway.closesAt,
        drawCommitment: giveaway.drawCommitment,
        entriesRoot: giveaway.entriesRoot,
        entryCount: giveaway.entries.length,
        entropyTargetBlueScore: giveaway.entropyTargetBlueScore,
        publicId: giveaway.publicId,
      });
    } catch {
      return apiError(ErrorCodes.SERVER_ERROR, "Giveaway freeze proof is invalid.", 500);
    }
  }
  if (drawn) {
    try {
      if (giveaway.drawProtocolVersion >= 2) {
        if (
          !giveaway.entriesRoot ||
          giveaway.entropyTargetBlueScore === null ||
          giveaway.entropyBlockBlueScore === null ||
          !giveaway.entropyBlockHash
        ) {
          throw new Error("Giveaway draw v2 proof is incomplete.");
        }
        const v2Proof = computeGiveawayDrawV2({
          closesAt: giveaway.closesAt,
          drawCommitment: giveaway.drawCommitment,
          entries: giveaway.entries,
          entriesRoot: giveaway.entriesRoot,
          entropyBlockBlueScore: giveaway.entropyBlockBlueScore,
          entropyBlockHash: giveaway.entropyBlockHash,
          entropyTargetBlueScore: giveaway.entropyTargetBlueScore,
          publicId: giveaway.publicId,
          seedHex: giveaway.drawSeedHex,
        });
        proof = v2Proof;
        if (freezeCommitment !== v2Proof.freezeCommitment) {
          throw new Error("Giveaway freeze commitment changed after the draw.");
        }
      } else {
        proof = computeGiveawayDraw({
          closesAt: giveaway.closesAt,
          entries: giveaway.entries,
          publicId: giveaway.publicId,
          seedHex: giveaway.drawSeedHex,
        });
      }
    } catch {
      return apiError(ErrorCodes.SERVER_ERROR, "Giveaway draw proof is invalid.", 500);
    }

    if (
      proof.digest !== giveaway.drawDigest ||
      proof.winnerAddress !== giveaway.winnerAddress ||
      proof.winnerEntryId !== giveaway.winnerEntryId ||
      proof.winnerIndex !== giveaway.winnerIndex ||
      !verifyGiveawaySeed(giveaway.drawSeedHex, giveaway.drawCommitment)
    ) {
      return apiError(ErrorCodes.SERVER_ERROR, "Giveaway draw proof is inconsistent.", 500);
    }
  }

  if (reconciled.status === GiveawayStatus.NO_ENTRIES) {
    const expectedDigest =
      giveaway.drawProtocolVersion >= 2 &&
      giveaway.entriesRoot &&
      giveaway.entropyTargetBlueScore !== null
        ? computeGiveawayFreezeCommitment({
            closesAt: giveaway.closesAt,
            drawCommitment: giveaway.drawCommitment,
            entriesRoot: giveaway.entriesRoot,
            entryCount: 0,
            entropyTargetBlueScore: giveaway.entropyTargetBlueScore,
            publicId: giveaway.publicId,
          })
        : computeEmptyGiveawayDrawDigest({
            closesAt: giveaway.closesAt,
            publicId: giveaway.publicId,
            seedHex: giveaway.drawSeedHex,
          });
    if (
      giveaway.drawDigest !== expectedDigest ||
      giveaway.entryCountAtDraw !== 0 ||
      !verifyGiveawaySeed(giveaway.drawSeedHex, giveaway.drawCommitment)
    ) {
      return apiError(ErrorCodes.SERVER_ERROR, "Giveaway draw proof is inconsistent.", 500);
    }
  }

  const verifiedWinnerPayout = Boolean(
    reconciled.prizeLink?.status === "claimed" &&
    reconciled.prizeLink.claimTxId &&
    reconciled.prizeLink.claimTxId.toLowerCase() ===
      reconciled.prizeClaimTransactionId?.toLowerCase(),
  );

  return apiJson({
    giveaway: {
      amountKas: formatSompiToKaspa(reconciled.amountSompi),
      closesAt: reconciled.closesAt.toISOString(),
      description: reconciled.description,
      entryWindowSeconds: reconciled.entryWindowSeconds,
      drawCommitment: reconciled.drawCommitment,
      drawProtocol: {
        entropyBlockBlueScore: reconciled.entropyBlockBlueScore?.toString() ?? null,
        entropyBlockHash: reconciled.entropyBlockHash,
        entropyTargetBlueScore: reconciled.entropyTargetBlueScore?.toString() ?? null,
        entriesFrozenAt: reconciled.entriesFrozenAt?.toISOString() ?? null,
        entriesRoot: reconciled.entriesRoot,
        entryHashes: frozenEntryHashes,
        entryCount: reconciled.entryCountAtDraw,
        freezeCommitment,
        version: reconciled.drawProtocolVersion,
      },
      drawProof:
        drawn || reconciled.status === GiveawayStatus.NO_ENTRIES
          ? {
              digest: giveaway.drawDigest,
              entryCount: giveaway.entryCountAtDraw,
              entryHashes: proof?.entryHashes ?? [],
              entropyBlockBlueScore: giveaway.entropyBlockBlueScore?.toString() ?? null,
              entropyBlockHash: giveaway.entropyBlockHash,
              entropyTargetBlueScore: giveaway.entropyTargetBlueScore?.toString() ?? null,
              entriesRoot: giveaway.entriesRoot,
              freezeCommitment,
              seed: giveaway.drawSeedHex,
              version: giveaway.drawProtocolVersion,
              winnerIndex: giveaway.winnerIndex,
            }
          : null,
      entryCount: giveaway._count.entries,
      // Entrants only learn whether the prize is really parked on-chain and
      // where to verify it. Never the claim code — that stays in the browser
      // of whoever created the giveaway.
      prize:
        reconciled.prizeLink && reconciled.prizeLink.fundingTxId
          ? {
              claimTxId: verifiedWinnerPayout ? reconciled.prizeLink.claimTxId : null,
              fundingAddress: reconciled.prizeLink.fundingAddress,
              fundingTxId: reconciled.prizeLink.fundingTxId,
              paidOut: verifiedWinnerPayout,
            }
          : null,
      winnerClaim: {
        expiresAt: reconciled.winnerClaimExpiresAt?.toISOString() ?? null,
        prepared: reconciled.prizeClaimTransactionSafeJson !== null,
        transactionId: verifiedWinnerPayout ? (reconciled.prizeLink?.claimTxId ?? null) : null,
      },
      publicId: reconciled.publicId,
      status: effectiveGiveawayStatus(
        reconciled.status,
        reconciled.closesAt,
        new Date(),
        reconciled.openedAt,
      ),
      title: reconciled.title,
      winnerAddress: reconciled.winnerAddress,
    },
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const guard = await requireCreator(request, prisma, { allowTelegramMiniApp: true });
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, guard.creator.id);
  if (!limited.allowed) return limited.response;

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const giveaway = await prisma.giveaway.findFirst({
    include: {
      prizeLink: {
        select: {
          amountSompi: true,
          claimTxId: true,
          createdAt: true,
          feeSompi: true,
          fundingAddress: true,
          fundingOutputIndex: true,
          fundingTxId: true,
          id: true,
          linkKey: true,
          redeemScriptHex: true,
          refundLockTime: true,
          refundTxId: true,
          status: true,
        },
      },
    },
    where: { creatorId: guard.creator.id, publicId: parsedId.data },
  });
  if (!giveaway) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  let reconciled = giveaway;
  if (giveaway.prizeLink) {
    try {
      reconciled = await reconcileGiveawayPrize(giveaway, new Date(), { force: true });
    } catch {
      return apiError(
        ErrorCodes.SERVER_ERROR,
        "The prize could not be verified on-chain. Try deleting again later.",
        503,
      );
    }
  }

  const prize = reconciled.prizeLink;
  const prizeIsClosed = prize?.status === "claimed" || prize?.status === "refunded";
  const prizeIsVerifiedUnfunded =
    prize?.status === "awaiting_funding" && prize.fundingTxId === null;
  if (prize && !prizeIsClosed && !prizeIsVerifiedUnfunded) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      prize.status === "spent_unknown"
        ? "The prize spend is not identified yet. Verify its on-chain state before deleting this giveaway."
        : "The parked prize must be paid to the winner or refunded before this giveaway can be deleted.",
      409,
    );
  }

  await prisma.giveaway.delete({ where: { id: giveaway.id } });

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "giveaway.deleted",
    ipHash: guard.ipHash,
    metadata: {
      prizeLinkPreserved: Boolean(prize),
      prizeStatus: prize?.status ?? null,
      publicId: giveaway.publicId,
      status: giveaway.status,
    },
  });

  return apiJson({ deleted: true, publicId: giveaway.publicId });
}

const methodNotAllowed = () => apiMethodNotAllowed(["DELETE", "GET"]);
export { methodNotAllowed as PATCH, methodNotAllowed as POST, methodNotAllowed as PUT };
