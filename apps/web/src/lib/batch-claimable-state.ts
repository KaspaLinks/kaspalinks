import type { BatchRecoveryRecord } from "./batch-claimable-recovery";

export type RegisteredBatchChildState = {
  claimTxId: null | string;
  deletedAt: null | string;
  fundingOutputIndex: null | number;
  fundingTxId: null | string;
  linkKey: string;
  outputIndex: number;
  refundTxId: null | string;
  status: string;
};

export type RegisteredBatchState = {
  activationTxId: null | string;
  fundingOutputIndex: null | number;
  fundingTxId: null | string;
  outputs: RegisteredBatchChildState[];
  refundTxId: null | string;
  status: string;
};

export const REGISTERED_TERMINAL_BATCH_CHILD_STATUSES = [
  "claimed",
  "refunded",
  "spent_unknown",
] as const;

export const TERMINAL_BATCH_CHILD_STATUSES = [
  ...REGISTERED_TERMINAL_BATCH_CHILD_STATUSES,
  "spent",
] as const;

const TERMINAL_CHILD_STATUSES = new Set<string>(TERMINAL_BATCH_CHILD_STATUSES);

export function isTerminalBatchChildStatus(status: string): boolean {
  return TERMINAL_CHILD_STATUSES.has(status);
}

export function reconcileBatchWithServer(
  batch: BatchRecoveryRecord,
  server: RegisteredBatchState,
): BatchRecoveryRecord {
  const childByKey = new Map(server.outputs.map((output) => [output.linkKey, output]));
  const activationStatus = reconcileActivationStatus(batch.activation.status, server.status);
  const activationFundingMatch =
    server.fundingTxId && server.fundingOutputIndex !== null
      ? {
          amountSompi: batch.activation.fundingAmountSompi,
          blockTime: batch.activation.fundingMatch?.blockTime ?? null,
          outputIndex: server.fundingOutputIndex,
          transactionId: server.fundingTxId,
        }
      : batch.activation.fundingMatch;

  const links = batch.links.map((link) => {
    const serverLink = childByKey.get(link.id);
    if (!serverLink) return link;

    const fundingTransactionId = serverLink.fundingTxId ?? server.activationTxId;
    const fundingOutputIndex = serverLink.fundingOutputIndex ?? serverLink.outputIndex;
    const fundingMatch = fundingTransactionId
      ? {
          amountSompi: link.amountSompi,
          blockTime: link.fundingMatch?.blockTime ?? null,
          outputIndex: fundingOutputIndex,
          transactionId: fundingTransactionId,
        }
      : link.fundingMatch;
    const deletedAt = serverLink.deletedAt ?? link.deletedAt;
    const status = reconcileChildStatus(link.status, serverLink.status);

    if (
      deletedAt === link.deletedAt &&
      status === link.status &&
      sameBatchFundingMatch(fundingMatch, link.fundingMatch)
    ) {
      return link;
    }

    return {
      ...link,
      deletedAt,
      fundingMatch,
      status,
    };
  });
  const unchanged =
    activationStatus === batch.activation.status &&
    sameBatchFundingMatch(activationFundingMatch, batch.activation.fundingMatch) &&
    links.every((link, index) => link === batch.links[index]);
  if (unchanged) return batch;

  return {
    ...batch,
    activation: {
      ...batch.activation,
      fundingMatch: activationFundingMatch,
      status: activationStatus,
    },
    links,
  };
}

function reconcileActivationStatus(
  local: BatchRecoveryRecord["activation"]["status"],
  server: string,
): BatchRecoveryRecord["activation"]["status"] {
  if (local === "refunded" || local === "activated") return local;
  if (server === "refunded") return "refunded";
  if (server === "activated") return "activated";
  if (local === "funded") return "funded";
  if (server === "funded") return "funded";
  return local;
}

function reconcileChildStatus(
  local: BatchRecoveryRecord["links"][number]["status"],
  server: string,
): BatchRecoveryRecord["links"][number]["status"] {
  if ((REGISTERED_TERMINAL_BATCH_CHILD_STATUSES as readonly string[]).includes(server)) {
    return server as BatchRecoveryRecord["links"][number]["status"];
  }
  if (isTerminalBatchChildStatus(local)) {
    return local === "spent" ? "spent_unknown" : local;
  }
  if (server === "refundable") return "refundable";
  if (server === "funded" || server === "shared") return "funded";
  return local;
}

export function sameBatchFundingMatch(
  left: BatchRecoveryRecord["activation"]["fundingMatch"],
  right: BatchRecoveryRecord["activation"]["fundingMatch"],
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.amountSompi === right.amountSompi &&
    left.blockTime === right.blockTime &&
    left.outputIndex === right.outputIndex &&
    left.transactionId === right.transactionId
  );
}
