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

const TERMINAL_CHILD_STATUSES = new Set(["claimed", "refunded", "spent_unknown", "spent"]);

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

  return {
    ...batch,
    activation: {
      ...batch.activation,
      fundingMatch: activationFundingMatch,
      status: activationStatus,
    },
    links: batch.links.map((link) => {
      const serverLink = childByKey.get(link.id);
      if (!serverLink) return link;

      const fundingTransactionId = serverLink.fundingTxId ?? server.activationTxId;
      const fundingOutputIndex = serverLink.fundingOutputIndex ?? serverLink.outputIndex;
      return {
        ...link,
        deletedAt: serverLink.deletedAt ?? link.deletedAt,
        fundingMatch: fundingTransactionId
          ? {
              amountSompi: link.amountSompi,
              blockTime: link.fundingMatch?.blockTime ?? null,
              outputIndex: fundingOutputIndex,
              transactionId: fundingTransactionId,
            }
          : link.fundingMatch,
        status: reconcileChildStatus(link.status, serverLink.status),
      };
    }),
  };
}

function reconcileActivationStatus(
  local: BatchRecoveryRecord["activation"]["status"],
  server: string,
): BatchRecoveryRecord["activation"]["status"] {
  if (server === "refunded") return "refunded";
  if (server === "activated") return "activated";
  if (local === "refunded" || local === "activated") return local;
  if (server === "funded") return "funded";
  if (server === "awaiting_funding") return "awaiting_funding";
  return local;
}

function reconcileChildStatus(
  local: BatchRecoveryRecord["links"][number]["status"],
  server: string,
): BatchRecoveryRecord["links"][number]["status"] {
  if (server === "claimed" || server === "refunded" || server === "spent_unknown") return server;
  if (TERMINAL_CHILD_STATUSES.has(local)) {
    return local === "spent" ? "spent_unknown" : local;
  }
  if (server === "refundable") return "refundable";
  if (server === "funded" || server === "shared") return "funded";
  return local;
}
