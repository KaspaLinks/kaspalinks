import { TOCCATA_CANARY_DAA_PER_SECOND_ESTIMATE } from "./toccata-lab-fee";

export type ClaimableExpiryEstimate = {
  endsAtMs: number;
  expired: boolean;
  remainingLabel: string;
};

type ClaimableExpiryEstimateInput = {
  currentDaaScore: string;
  daaLoadedAtMs: null | number;
  nowMs: number;
  refundLockTime: string;
};

// The claim contract uses a DAA-score lock time, not wall-clock time. This
// turns the current on-chain score into a clear, deliberately approximate
// wall-clock countdown for creator-facing UI.
export function estimateClaimableExpiry(
  input: ClaimableExpiryEstimateInput,
): ClaimableExpiryEstimate | null {
  if (!input.currentDaaScore || !input.refundLockTime || input.daaLoadedAtMs === null) {
    return null;
  }

  try {
    const current = BigInt(input.currentDaaScore);
    const refundAfter = BigInt(input.refundLockTime);
    const elapsedSeconds = BigInt(
      Math.max(0, Math.floor((input.nowMs - input.daaLoadedAtMs) / 1000)),
    );
    const projected = current + elapsedSeconds * TOCCATA_CANARY_DAA_PER_SECOND_ESTIMATE;

    // Only the last real DAA score may switch the creator UI to "expired".
    // The projection keeps the countdown smooth between refreshes, but must
    // never show a refund as available ahead of consensus.
    if (refundAfter <= current) {
      return { endsAtMs: input.nowMs, expired: true, remainingLabel: "Expired" };
    }

    const remainingDaa = refundAfter - projected;
    if (remainingDaa <= 0n) {
      return { endsAtMs: input.nowMs + 1_000, expired: false, remainingLabel: "less than a minute" };
    }

    const remainingSeconds =
      (remainingDaa + TOCCATA_CANARY_DAA_PER_SECOND_ESTIMATE - 1n) /
      TOCCATA_CANARY_DAA_PER_SECOND_ESTIMATE;
    const safeSeconds = Number(remainingSeconds);
    if (!Number.isSafeInteger(safeSeconds)) return null;

    return {
      endsAtMs: input.nowMs + safeSeconds * 1000,
      expired: false,
      remainingLabel: formatClaimableRemainingTime(remainingSeconds),
    };
  } catch {
    return null;
  }
}

export function formatClaimableRemainingTime(seconds: bigint): string {
  if (seconds < 60n) return `${seconds.toString()} sec`;

  const minutes = seconds / 60n;
  const remainingSeconds = seconds % 60n;
  if (minutes < 60n) {
    return remainingSeconds > 0n
      ? `${minutes.toString()} min ${remainingSeconds.toString()} sec`
      : `${minutes.toString()} min`;
  }

  const hours = minutes / 60n;
  const remainingMinutes = minutes % 60n;
  if (hours < 48n) {
    return remainingMinutes > 0n
      ? `${hours.toString()} h ${remainingMinutes.toString()} min`
      : `${hours.toString()} h`;
  }

  const days = hours / 24n;
  const remainingHours = hours % 24n;
  return remainingHours > 0n
    ? `${days.toString()} days ${remainingHours.toString()} h`
    : `${days.toString()} days`;
}
