import { AuditActorType, GiveawayStatus, prisma } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { giveawayPublicIdSchema, isGiveawayLabEnabled } from "@/lib/giveaway-lab";
import { verifyPreparedGiveawayPrizeClaim } from "@/lib/giveaway-prize-claim";
import { reconcileGiveawayPrize } from "@/lib/giveaway-prize";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { broadcastToccataClaimableTransaction } from "@/lib/toccata-lab";

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_CLAIMABLE_BROADCAST, ipHash);
  if (!limited.allowed) return limited.response;

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const giveaway = await prisma.giveaway.findUnique({
    include: { prizeLink: true },
    where: { publicId: parsedId.data },
  });
  if (!giveaway) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  let reconciled: typeof giveaway;
  try {
    reconciled = await reconcileGiveawayPrize(giveaway, new Date(), { force: true });
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Prize state could not be verified on-chain. Try again shortly.",
      503,
    );
  }

  if (reconciled.prizeLink?.status === "claimed" && reconciled.prizeLink.claimTxId) {
    return apiJson({
      claimed: true,
      transactionId: reconciled.prizeLink.claimTxId,
    });
  }
  if (reconciled.status !== GiveawayStatus.DRAWN || !reconciled.winnerAddress) {
    return apiError(ErrorCodes.INVALID_STATE, "The giveaway has not selected a winner.", 409);
  }
  if (!reconciled.winnerClaimExpiresAt || reconciled.winnerClaimExpiresAt.getTime() <= Date.now()) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "The winner claim window has expired. The creator can now recover the prize.",
      409,
    );
  }
  if (
    !reconciled.prizeLink ||
    !reconciled.prizeClaimTransactionId ||
    !reconciled.prizeClaimTransactionSafeJson
  ) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "The creator has not prepared the winner claim yet.",
      409,
    );
  }
  if (["refunded", "spent_unknown"].includes(reconciled.prizeLink.status)) {
    return apiError(ErrorCodes.INVALID_STATE, "The giveaway prize is no longer available.", 409);
  }

  try {
    verifyPreparedGiveawayPrizeClaim({
      expectedTransactionId: reconciled.prizeClaimTransactionId,
      link: reconciled.prizeLink,
      transactionSafeJson: reconciled.prizeClaimTransactionSafeJson,
      winnerAddress: reconciled.winnerAddress,
    });

    const broadcast = await broadcastToccataClaimableTransaction({
      expectedTransactionId: reconciled.prizeClaimTransactionId,
      linkKey: reconciled.prizeLink.linkKey,
      transactionSafeJson: reconciled.prizeClaimTransactionSafeJson,
    });
    await markPrizeClaimed(reconciled.prizeLink.id, broadcast.submittedTransactionId);

    await writeAuditLog(prisma, {
      actorType: AuditActorType.PUBLIC,
      creatorId: reconciled.creatorId,
      event: "giveaway.prize_claimed",
      ipHash,
      metadata: {
        publicId: reconciled.publicId,
        transactionId: broadcast.submittedTransactionId,
      },
    });

    return apiJson({
      claimed: true,
      transactionId: broadcast.submittedTransactionId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prize claim failed.";
    if (/already accepted|was already accepted by the consensus/i.test(message)) {
      await markPrizeClaimed(reconciled.prizeLink.id, reconciled.prizeClaimTransactionId);
      return apiJson({
        claimed: true,
        transactionId: reconciled.prizeClaimTransactionId,
      });
    }
    return apiError(
      message.toLowerCase().includes("timed out")
        ? ErrorCodes.UPSTREAM_TIMEOUT
        : ErrorCodes.INVALID_BODY,
      message,
      message.toLowerCase().includes("timed out") ? 504 : 400,
    );
  }
}

async function markPrizeClaimed(linkId: string, transactionId: string): Promise<void> {
  await prisma.claimableLink.updateMany({
    data: {
      claimedAt: new Date(),
      claimTxId: transactionId,
      status: "claimed",
    },
    where: {
      id: linkId,
      status: { notIn: ["claimed", "refunded", "spent_unknown"] },
    },
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
