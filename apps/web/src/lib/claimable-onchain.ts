import { createRestKaspaIndexer, KaspaIndexerError } from "@kaspa-actions/kaspa-indexer";

// Server-side on-chain status resolution for claimable links. Lets the DB status
// stay correct even when a STRANGER claims (they never touch our server): the
// funding output is spent on-chain. A missing UTXO alone does not prove whether
// the claim or refund branch won, so only a server-recorded terminal tx id may
// classify it. Unknown external spends close the link as spent_unknown.

const KASPA_REST_BASE_URL = "https://api.kaspa.org";
const UTXO_REQUEST_TIMEOUT_MS = 7_000;
const RECENT_FUNDING_SPENT_GRACE_MS = 10_000;

export type ClaimableOnChainInput = {
  status: string;
  claimTxId: string | null;
  fundingAddress: string;
  amountSompi: string;
  fundingTxId: string | null;
  fundingOutputIndex: number | null;
  createdAtMs: number;
  refundLockTime: string;
  refundTxId: string | null;
};

export type ClaimableOnChainUpdate = {
  status: string;
  fundingTxId?: string;
  fundingOutputIndex?: number;
};

export async function resolveClaimableOnChain(
  input: ClaimableOnChainInput,
): Promise<ClaimableOnChainUpdate | null> {
  // Terminal states never change again.
  if (
    input.status === "claimed" ||
    input.status === "refunded" ||
    input.status === "spent_unknown"
  ) {
    return null;
  }

  const indexer = createRestKaspaIndexer({ cacheRevalidateSeconds: 3, limit: 20 });
  const amountSompi = BigInt(input.amountSompi);

  // Not yet funded: look for an incoming payment of the exact amount.
  if (input.status === "awaiting_funding" && !input.fundingTxId) {
    const match = await indexer.findIncomingPayment({
      amountSompi,
      notBefore: input.createdAtMs,
      recipientAddress: input.fundingAddress,
      scanLimit: 20,
    });
    if (match) {
      return {
        status: "funded",
        fundingTxId: match.transactionId,
        fundingOutputIndex: match.outputIndex,
      };
    }
    return null;
  }

  // Funded or later: determine whether the exact funding output still exists.
  const txId = input.fundingTxId;
  const outIndex = input.fundingOutputIndex;
  if (!txId || outIndex === null) return null;

  const match = await indexer.findTransactionPayment({
    amountSompi,
    notBefore: input.createdAtMs,
    recipientAddress: input.fundingAddress,
    transactionId: txId,
  });
  if (!match || match.outputIndex !== outIndex) return null;

  const spent = await isFundingOutputSpent({
    amountSompi: match.matchedSompi,
    blockTime: match.blockTime,
    fundingAddress: input.fundingAddress,
    outputIndex: match.outputIndex,
    transactionId: match.transactionId,
  });
  if (spent) {
    if (input.claimTxId) return { status: "claimed" };
    if (input.refundTxId) return { status: "refunded" };
    return { status: "spent_unknown" };
  }

  return (await isRefundUnlocked(input.refundLockTime)) ? { status: "refundable" } : null;
}

async function isRefundUnlocked(refundLockTime: string): Promise<boolean> {
  if (!/^[0-9]+$/.test(refundLockTime)) return false;

  try {
    const response = await fetch(`${KASPA_REST_BASE_URL}/info/blockdag`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { virtualDaaScore?: unknown };
    return (
      typeof body.virtualDaaScore === "string" &&
      /^[0-9]+$/.test(body.virtualDaaScore) &&
      BigInt(body.virtualDaaScore) >= BigInt(refundLockTime)
    );
  } catch {
    return false;
  }
}

async function isFundingOutputSpent(input: {
  amountSompi: bigint;
  blockTime: null | number;
  fundingAddress: string;
  outputIndex: number;
  transactionId: string;
}): Promise<boolean> {
  // Just-funded outputs can lag in the indexer; don't call them "spent" yet.
  if (
    input.blockTime !== null &&
    Date.now() - input.blockTime >= 0 &&
    Date.now() - input.blockTime < RECENT_FUNDING_SPENT_GRACE_MS
  ) {
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UTXO_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${KASPA_REST_BASE_URL}/addresses/${encodeURIComponent(input.fundingAddress)}/utxos`,
      { headers: { accept: "application/json" }, signal: controller.signal },
    );
    if (!response.ok) {
      throw new KaspaIndexerError(`Indexer responded with status ${response.status}.`, {
        code: "INDEXER_HTTP_ERROR",
      });
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new KaspaIndexerError("Indexer returned an unexpected UTXO payload shape.", {
        code: "INDEXER_PARSE_ERROR",
      });
    }
    return !payload.some((entry) =>
      isMatchingFundingUtxo(entry, {
        amountSompi: input.amountSompi,
        outputIndex: input.outputIndex,
        transactionId: input.transactionId,
      }),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function isMatchingFundingUtxo(
  value: unknown,
  expected: { amountSompi: bigint; outputIndex: number; transactionId: string },
): boolean {
  if (!isRecord(value) || !isRecord(value.outpoint) || !isRecord(value.utxoEntry)) {
    return false;
  }
  const transactionId = value.outpoint.transactionId;
  const index = value.outpoint.index;
  const amount = parseSompi(value.utxoEntry.amount);
  return (
    typeof transactionId === "string" &&
    transactionId.toLowerCase() === expected.transactionId.toLowerCase() &&
    typeof index === "number" &&
    index === expected.outputIndex &&
    amount === expected.amountSompi
  );
}

function parseSompi(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  return BigInt(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
