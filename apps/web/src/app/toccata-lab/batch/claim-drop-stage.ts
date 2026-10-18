import { isTerminalBatchChildStatus } from "@/lib/batch-claimable-state";
import type { BatchRecoveryRecord } from "@/lib/batch-claimable-recovery";

/**
 * The one thing a Claim Drop needs from its creator right now. The page shows
 * only this step, so it never offers funding after payment, activation after
 * the links exist, or refunds for links that were already claimed.
 */
export type ClaimDropStage =
  /** The recovery file must be saved before payment details appear. */
  | "save"
  /** Waiting for the exact payment to the one-time address. */
  | "fund"
  /** Paid; the individual claim links are being created. */
  | "activate"
  /** Paid but never activated, and the claim window has ended. */
  | "refund_unactivated"
  /** The links exist and can be shared and claimed. */
  | "share"
  /** The claim window ended with links still unclaimed. */
  | "refund_links"
  /** Every link is claimed or refunded, or the whole drop was refunded. */
  | "done";

type StageInput = {
  batch: Pick<BatchRecoveryRecord, "activation" | "links" | "recoveryExportedAt">;
  /** Whether the claim window has ended; null while the chain time is unknown. */
  expired: boolean | null;
};

export function claimDropStage({ batch, expired }: StageInput): ClaimDropStage {
  const status = batch.activation.status;
  if (status === "refunded") return "done";
  if (status === "activated") {
    const open = batch.links.filter((link) => !isTerminalBatchChildStatus(link.status));
    if (open.length === 0) return "done";
    return expired ? "refund_links" : "share";
  }
  if (!batch.recoveryExportedAt) return "save";
  if (status === "awaiting_funding") return "fund";
  return expired ? "refund_unactivated" : "activate";
}

export type ClaimDropProgress = {
  claimed: number;
  open: number;
  refunded: number;
  total: number;
};

export function claimDropProgress(batch: Pick<BatchRecoveryRecord, "links">): ClaimDropProgress {
  const claimed = batch.links.filter((link) => link.status === "claimed").length;
  const refunded = batch.links.filter((link) => link.status === "refunded").length;
  const open = batch.links.filter((link) => !isTerminalBatchChildStatus(link.status)).length;
  return { claimed, open, refunded, total: batch.links.length };
}

/** A creator-facing word for one link's state. */
export function claimLinkLabel(
  status: BatchRecoveryRecord["links"][number]["status"],
  expired: boolean | null,
): string {
  switch (status) {
    case "awaiting_activation":
      return "Not active yet";
    case "funded":
      return expired ? "Refundable" : "Ready";
    case "refundable":
      return "Refundable";
    case "claimed":
      return "Claimed";
    case "refunded":
      return "Refunded";
    case "spent":
    case "spent_unknown":
      return "Spent";
  }
}
