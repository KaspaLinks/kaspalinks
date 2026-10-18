/**
 * The one thing a single claim link needs from its creator right now. The
 * create page shows only this step, like a Claim Drop does.
 */
export type SingleClaimStage =
  /** No link yet: the form. */
  | "form"
  /** Classic refund-key link: the recovery file comes before the payment details. */
  | "save"
  /** Waiting for the exact payment to the one-time address. */
  | "fund"
  /** Never paid and the claim window is over: nothing is locked, start again. */
  | "expired_unfunded"
  /** Paid and claimable: share the link. */
  | "share"
  /** Auto-return link after its window: the KAS is on its way back. */
  | "returning"
  /** Classic link after its window: the creator refunds with the private link. */
  | "refund"
  /** Claimed, returned or otherwise spent. */
  | "done";

const DONE = new Set(["claimed", "refunded", "spent_unknown"]);
const UNPAID = new Set(["draft", "awaiting_funding"]);

export function singleClaimStage(input: {
  autoReturn: boolean;
  recoveryReady: boolean;
  status: null | string;
  /** Whether the claim window has passed; false while the chain time is unknown. */
  windowEnded: boolean;
}): SingleClaimStage {
  const { status } = input;
  if (status === null) return "form";
  if (DONE.has(status)) return "done";
  if (UNPAID.has(status)) {
    if (input.windowEnded) return "expired_unfunded";
    return input.autoReturn || input.recoveryReady ? "fund" : "save";
  }
  if (input.windowEnded || status === "refundable") {
    return input.autoReturn ? "returning" : "refund";
  }
  return input.autoReturn || input.recoveryReady ? "share" : "save";
}
