import { AuditActorType, GiveawayStatus, prisma } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { giveawayPublicIdSchema, isGiveawayLabEnabled } from "@/lib/giveaway-lab";
import { verifyPreparedGiveawayPrizeClaim } from "@/lib/giveaway-prize-claim";
import { reconcileGiveawayPrize } from "@/lib/giveaway-prize";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { toccataClaimableBroadcastInputSchema } from "@/lib/toccata-lab";

const prepareGiveawayPrizeClaimInputSchema = toccataClaimableBroadcastInputSchema.strict();

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, guard.creator.id);
  if (!limited.allowed) return limited.response;

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = prepareGiveawayPrizeClaimInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid prepared prize transaction.",
      400,
    );
  }

  const giveaway = await prisma.giveaway.findFirst({
    include: { prizeLink: true },
    where: { creatorId: guard.creator.id, publicId: parsedId.data },
  });
  if (!giveaway) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  let reconciled: typeof giveaway;
  try {
    reconciled = await reconcileGiveawayPrize(giveaway, new Date(), { force: true });
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Prize funding could not be verified on-chain. Try again shortly.",
      503,
    );
  }

  if (
    reconciled.status !== GiveawayStatus.DRAWN ||
    !reconciled.winnerAddress ||
    !reconciled.winnerClaimExpiresAt
  ) {
    return apiError(ErrorCodes.INVALID_STATE, "A winner must be drawn first.", 409);
  }
  if (reconciled.winnerClaimExpiresAt.getTime() <= Date.now()) {
    return apiError(ErrorCodes.INVALID_STATE, "The winner claim window has expired.", 409);
  }
  if (!reconciled.prizeLink || parsed.data.linkKey !== reconciled.prizeLink.linkKey) {
    return apiError(ErrorCodes.INVALID_STATE, "Giveaway prize link does not match.", 409);
  }
  if (["claimed", "refunded", "spent_unknown"].includes(reconciled.prizeLink.status)) {
    return apiError(ErrorCodes.INVALID_STATE, "The giveaway prize is already closed.", 409);
  }

  try {
    verifyPreparedGiveawayPrizeClaim({
      expectedTransactionId: parsed.data.expectedTransactionId,
      link: reconciled.prizeLink,
      transactionSafeJson: parsed.data.transactionSafeJson,
      winnerAddress: reconciled.winnerAddress,
    });
  } catch (error) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      error instanceof Error ? error.message : "Prepared prize transaction is invalid.",
      400,
    );
  }

  const now = new Date();
  await prisma.giveaway.update({
    data: {
      prizeClaimPreparedAt: now,
      prizeClaimTransactionId: parsed.data.expectedTransactionId.toLowerCase(),
      prizeClaimTransactionSafeJson: parsed.data.transactionSafeJson,
    },
    where: { id: reconciled.id },
  });

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "giveaway.prize_claim_prepared",
    ipHash: guard.ipHash,
    metadata: {
      expiresAt: reconciled.winnerClaimExpiresAt.toISOString(),
      publicId: reconciled.publicId,
      transactionId: parsed.data.expectedTransactionId.toLowerCase(),
    },
  });

  return apiJson({
    prepared: {
      expiresAt: reconciled.winnerClaimExpiresAt.toISOString(),
      preparedAt: now.toISOString(),
      transactionId: parsed.data.expectedTransactionId.toLowerCase(),
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
