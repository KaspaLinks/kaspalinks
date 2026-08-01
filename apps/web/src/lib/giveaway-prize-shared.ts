export const GIVEAWAY_FUNDING_GRACE_SECONDS = 60 * 60;
export const GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS = 24 * 60 * 60;
export const GIVEAWAY_MIN_WINNER_CLAIM_SECONDS = 60;
export const GIVEAWAY_MAX_WINNER_CLAIM_SECONDS = 7 * 24 * 60 * 60;

export function giveawayRefundDelaySeconds(
  entryWindowSeconds: number,
  winnerClaimWindowSeconds = GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS,
): number {
  if (!Number.isFinite(entryWindowSeconds) || entryWindowSeconds <= 0) {
    throw new Error("Giveaway entry window must be a positive number of seconds.");
  }
  if (
    !Number.isFinite(winnerClaimWindowSeconds) ||
    winnerClaimWindowSeconds < GIVEAWAY_MIN_WINNER_CLAIM_SECONDS ||
    winnerClaimWindowSeconds > GIVEAWAY_MAX_WINNER_CLAIM_SECONDS
  ) {
    throw new Error("Giveaway winner claim window is outside the supported range.");
  }

  const wholeWindowSeconds = Math.ceil(entryWindowSeconds);
  const wholeClaimWindowSeconds = Math.ceil(winnerClaimWindowSeconds);
  const daaDriftMarginSeconds = Math.ceil((wholeWindowSeconds + wholeClaimWindowSeconds) * 0.02);
  return (
    GIVEAWAY_FUNDING_GRACE_SECONDS +
    wholeWindowSeconds +
    wholeClaimWindowSeconds +
    daaDriftMarginSeconds
  );
}

export function shouldPrepareGiveawayClaim(input: {
  claimTxId: null | string;
  fundingOutputIndex: null | number;
  fundingTxId: null | string;
  preparedTransactionId: null | string;
  prizeStatus: string;
  status: string;
  winnerAddress: null | string;
}): boolean {
  return Boolean(
    input.status === "DRAWN" &&
    input.winnerAddress &&
    input.fundingTxId &&
    input.fundingOutputIndex !== null &&
    !input.preparedTransactionId &&
    !input.claimTxId &&
    !["claimed", "refunded", "spent_unknown"].includes(input.prizeStatus),
  );
}
