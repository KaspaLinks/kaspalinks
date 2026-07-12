const DEFAULT_BASE_URL = "https://api.kaspa.org";
const DEFAULT_LIMIT = 10;
const ABSOLUTE_MAX_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 7_000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const REST_TRANSACTION_FIELDS = "transaction_id,outputs,block_time,is_accepted";

export type KaspaIndexerMatch = {
  blockTime: null | number;
  /** Sompi value of the matched output. Always positive. */
  matchedSompi: bigint;
  outputIndex: number;
  transactionId: string;
};

export type KaspaIndexerIncomingPayment = {
  blockTime: null | number;
  /** Sompi value of the output to the recipient. Always positive. */
  matchedSompi: bigint;
  outputIndex: number;
  transactionId: string;
};

export type FindIncomingPaymentInput = {
  /**
   * Exact sompi amount to match. When omitted or null, the indexer accepts any
   * positive-value output to the recipient (variable-amount Actions).
   */
  amountSompi?: bigint | null;
  /** Milliseconds since epoch. Only matches at or after this time are returned. */
  notBefore?: number;
  recipientAddress: string;
  /** Optional override of the per-call limit, capped by the indexer's hard limit. */
  scanLimit?: number;
};

export type FindTransactionPaymentInput = {
  /**
   * Exact sompi amount to match. When omitted or null, the indexer accepts any
   * positive-value output to the recipient (variable-amount Actions).
   */
  amountSompi?: bigint | null;
  /** Milliseconds since epoch. Only matches at or after this time are returned. */
  notBefore?: number;
  recipientAddress: string;
  transactionId: string;
};

export type ListIncomingPaymentsInput = {
  /** Milliseconds since epoch. Only accepted transactions at or after this time are returned. */
  notBefore?: number;
  recipientAddress: string;
  /** Optional override of the per-call limit, capped by the indexer's hard limit. */
  scanLimit?: number;
};

export type KaspaIndexer = {
  findIncomingPayment(input: FindIncomingPaymentInput): Promise<KaspaIndexerMatch | null>;
  findTransactionPayment(input: FindTransactionPaymentInput): Promise<KaspaIndexerMatch | null>;
  listIncomingPayments(input: ListIncomingPaymentsInput): Promise<KaspaIndexerIncomingPayment[]>;
  /** Stable identifier for the indexer, surfaced in audit logs and docs. */
  readonly providerId: string;
};

export type RestKaspaIndexerOptions = {
  baseUrl?: string;
  /**
   * When set, the indexer attaches `next: { revalidate: cacheRevalidateSeconds }`
   * to its fetch calls. In a Next.js server context this makes the underlying
   * upstream response shareable across concurrent requests for the given
   * window — multiple users hitting the same recipient address will trigger
   * one upstream request instead of N. Outside Next.js the option is a no-op
   * (extra `next` field is ignored by standard fetch).
   */
  cacheRevalidateSeconds?: number;
  /** Optional injection point for tests. */
  fetchImpl?: typeof fetch;
  limit?: number;
  /** Identifier surfaced in audit logs. */
  providerId?: string;
  timeoutMs?: number;
};

export class KaspaIndexerError extends Error {
  readonly code: string;

  constructor(message: string, options: { code: string }) {
    super(message);
    this.name = "KaspaIndexerError";
    this.code = options.code;
  }
}

export function createRestKaspaIndexer(options: RestKaspaIndexerOptions = {}): KaspaIndexer {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetchImpl = resolveFetch(options.fetchImpl);
  const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);
  const timeoutMs = Math.max(1_000, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const providerId = options.providerId?.trim() || `rest:${new URL(baseUrl).host}`;
  const cacheRevalidateSeconds =
    typeof options.cacheRevalidateSeconds === "number" && options.cacheRevalidateSeconds > 0
      ? Math.floor(options.cacheRevalidateSeconds)
      : null;

  async function findIncomingPayment(
    input: FindIncomingPaymentInput,
  ): Promise<KaspaIndexerMatch | null> {
    const recipientAddress = normalizeAddress(input.recipientAddress);
    const amountSompi = input.amountSompi ?? null;

    if (amountSompi !== null && amountSompi <= 0n) {
      return null;
    }

    const payload = await fetchAddressTransactions({
      limit: input.scanLimit,
      notBefore: input.notBefore,
      recipientAddress,
    });

    return findMatchingOutput(payload, recipientAddress, amountSompi, input.notBefore);
  }

  async function listIncomingPayments(
    input: ListIncomingPaymentsInput,
  ): Promise<KaspaIndexerIncomingPayment[]> {
    const recipientAddress = normalizeAddress(input.recipientAddress);
    const payload = await fetchAddressTransactions({
      limit: input.scanLimit,
      notBefore: input.notBefore,
      recipientAddress,
    });

    return listMatchingOutputs(payload, recipientAddress, input.notBefore);
  }

  async function findTransactionPayment(
    input: FindTransactionPaymentInput,
  ): Promise<KaspaIndexerMatch | null> {
    const recipientAddress = normalizeAddress(input.recipientAddress);
    const amountSompi = input.amountSompi ?? null;

    if (amountSompi !== null && amountSompi <= 0n) {
      return null;
    }

    const payload = await fetchTransaction(input.transactionId);
    if (!payload) {
      return null;
    }

    return findMatchingOutput([payload], recipientAddress, amountSompi, input.notBefore);
  }

  async function fetchAddressTransactions(input: {
    limit?: number;
    notBefore?: number;
    recipientAddress: string;
  }): Promise<unknown[]> {
    const requestedLimit = clampLimit(input.limit ?? limit);
    const params = new URLSearchParams();
    params.set("limit", String(requestedLimit));
    params.set("fields", REST_TRANSACTION_FIELDS);
    params.set("resolve_previous_outpoints", "no");

    if (typeof input.notBefore === "number" && Number.isFinite(input.notBefore)) {
      params.set("after", String(Math.max(0, Math.floor(input.notBefore - CLOCK_SKEW_MS))));
    }

    const url = `${baseUrl}/addresses/${encodeURIComponent(input.recipientAddress)}/full-transactions-page?${params.toString()}`;

    let response: Response;
    try {
      const requestInit: RequestInit & { next?: { revalidate: number } } = {
        headers: { accept: "application/json" },
      };
      if (cacheRevalidateSeconds !== null) {
        requestInit.next = { revalidate: cacheRevalidateSeconds };
      }
      response = await withTimeout(fetchImpl(url, requestInit), timeoutMs);
    } catch (error) {
      throw new KaspaIndexerError(
        `Indexer request to ${baseUrl} failed: ${(error as Error).message}`,
        { code: "INDEXER_NETWORK_ERROR" },
      );
    }

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new KaspaIndexerError(`Indexer responded with status ${response.status}.`, {
        code: "INDEXER_HTTP_ERROR",
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new KaspaIndexerError("Indexer returned a non-JSON response.", {
        code: "INDEXER_PARSE_ERROR",
      });
    }

    if (!Array.isArray(payload)) {
      throw new KaspaIndexerError("Indexer returned an unexpected payload shape.", {
        code: "INDEXER_PARSE_ERROR",
      });
    }

    return payload;
  }

  async function fetchTransaction(transactionId: string): Promise<unknown | null> {
    const normalizedTransactionId = normalizeTransactionId(transactionId);
    const url = `${baseUrl}/transactions/${encodeURIComponent(normalizedTransactionId)}`;

    let response: Response;
    try {
      response = await withTimeout(
        fetchImpl(url, {
          headers: { accept: "application/json" },
        }),
        timeoutMs,
      );
    } catch (error) {
      throw new KaspaIndexerError(
        `Indexer request to ${baseUrl} failed: ${(error as Error).message}`,
        { code: "INDEXER_NETWORK_ERROR" },
      );
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new KaspaIndexerError(`Indexer responded with status ${response.status}.`, {
        code: "INDEXER_HTTP_ERROR",
      });
    }

    try {
      return await response.json();
    } catch {
      throw new KaspaIndexerError("Indexer returned a non-JSON response.", {
        code: "INDEXER_PARSE_ERROR",
      });
    }
  }

  return {
    findIncomingPayment,
    findTransactionPayment,
    listIncomingPayments,
    providerId,
  };
}

function findMatchingOutput(
  transactions: unknown[],
  recipientAddress: string,
  amountSompi: bigint | null,
  notBefore: number | undefined,
): KaspaIndexerMatch | null {
  for (const tx of transactions) {
    if (!isRecord(tx)) continue;
    if (tx.is_accepted !== true) continue;

    const transactionId = typeof tx.transaction_id === "string" ? tx.transaction_id : null;
    if (!transactionId) continue;

    const blockTime = parseTimestamp(tx.block_time);
    if (
      typeof notBefore === "number" &&
      blockTime !== null &&
      blockTime < notBefore - CLOCK_SKEW_MS
    ) {
      continue;
    }

    if (!Array.isArray(tx.outputs)) continue;

    for (let index = 0; index < tx.outputs.length; index += 1) {
      const output = tx.outputs[index];
      if (!isRecord(output)) continue;

      const outputAddress = output.script_public_key_address;
      if (typeof outputAddress !== "string" || outputAddress !== recipientAddress) {
        continue;
      }

      const outputAmount = parseSompi(output.amount);
      if (outputAmount === null || outputAmount <= 0n) continue;

      if (amountSompi !== null && outputAmount !== amountSompi) {
        continue;
      }

      const outputIndex = typeof output.index === "number" ? output.index : index;

      return {
        blockTime,
        matchedSompi: outputAmount,
        outputIndex,
        transactionId,
      };
    }
  }

  return null;
}

function listMatchingOutputs(
  transactions: unknown[],
  recipientAddress: string,
  notBefore: number | undefined,
): KaspaIndexerIncomingPayment[] {
  const payments: KaspaIndexerIncomingPayment[] = [];

  for (const tx of transactions) {
    if (!isRecord(tx)) continue;
    if (tx.is_accepted !== true) continue;

    const transactionId = typeof tx.transaction_id === "string" ? tx.transaction_id : null;
    if (!transactionId) continue;

    const blockTime = parseTimestamp(tx.block_time);
    if (
      typeof notBefore === "number" &&
      blockTime !== null &&
      blockTime < notBefore - CLOCK_SKEW_MS
    ) {
      continue;
    }

    if (!Array.isArray(tx.outputs)) continue;

    for (let index = 0; index < tx.outputs.length; index += 1) {
      const output = tx.outputs[index];
      if (!isRecord(output)) continue;

      const outputAddress = output.script_public_key_address;
      if (typeof outputAddress !== "string" || outputAddress !== recipientAddress) {
        continue;
      }

      const outputAmount = parseSompi(output.amount);
      if (outputAmount === null || outputAmount <= 0n) continue;

      payments.push({
        blockTime,
        matchedSompi: outputAmount,
        outputIndex: typeof output.index === "number" ? output.index : index,
        transactionId,
      });
    }
  }

  return payments;
}

function parseSompi(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    if (!Number.isInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}

function parseTimestamp(value: unknown): null | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  const integer = Math.max(1, Math.floor(value));
  return Math.min(ABSOLUTE_MAX_LIMIT, integer);
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new KaspaIndexerError("recipientAddress is required.", {
      code: "INDEXER_INPUT_ERROR",
    });
  }
  return trimmed;
}

function normalizeTransactionId(transactionId: string): string {
  const normalized = transactionId.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new KaspaIndexerError("Invalid transaction id.", {
      code: "INDEXER_INVALID_TRANSACTION_ID",
    });
  }
  return normalized;
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new KaspaIndexerError(`Indexer baseUrl is not a valid URL: ${value}`, {
      code: "INDEXER_CONFIG_ERROR",
    });
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new KaspaIndexerError("Indexer baseUrl must use http or https.", {
      code: "INDEXER_CONFIG_ERROR",
    });
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path === "/" ? "" : path}`;
}

function resolveFetch(custom?: typeof fetch): typeof fetch {
  if (custom) return custom;
  if (typeof globalThis.fetch === "function") return globalThis.fetch.bind(globalThis);
  throw new KaspaIndexerError("No fetch implementation available.", {
    code: "INDEXER_CONFIG_ERROR",
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
