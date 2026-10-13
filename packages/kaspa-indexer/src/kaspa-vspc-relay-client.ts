import { z } from "zod";

import { KaspaVspcError, type KaspaVspcV2Client } from "./kaspa-vspc-v2";

const DEFAULT_TIMEOUT_MS = 35_000;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export type KaspaVspcRelayClientOptions = {
  relayUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type KaspaVspcRelayClient = KaspaVspcV2Client & {
  getBlockHeaders(hashes: readonly string[]): Promise<unknown>;
  submitTransaction(input: {
    expectedTransactionId: string;
    transactionSafeJson: string;
  }): Promise<{ localTransactionId: string; submittedTransactionId: string }>;
};

const transactionIdSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const submitResponseSchema = z
  .object({
    localTransactionId: transactionIdSchema,
    submittedTransactionId: transactionIdSchema,
  })
  .strict();

/**
 * Internal HTTP adapter for the private, warm wRPC sidecar. Caddy must never
 * expose these relay paths; public APIs consume only projected snapshots.
 */
export function createKaspaVspcRelayClient(
  options: KaspaVspcRelayClientOptions,
): KaspaVspcRelayClient {
  const baseUrl = normalizeRelayUrl(options.relayUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (fetchImpl === undefined) {
    throw new KaspaVspcError("VSPC_CONFIG_ERROR", "No fetch implementation is available.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000) {
    throw new KaspaVspcError(
      "VSPC_CONFIG_ERROR",
      "Relay timeout must be between 250 and 120000 milliseconds.",
    );
  }

  return {
    async getCurrentNetwork(): Promise<unknown> {
      return requestJson(fetchImpl, new URL("network", baseUrl), { method: "GET" }, timeoutMs);
    },
    async getVirtualChainFromBlockV2(request): Promise<unknown> {
      return requestJson(
        fetchImpl,
        new URL("virtual-chain-v2", baseUrl),
        {
          body: JSON.stringify(request),
          headers: { accept: "application/json", "content-type": "application/json" },
          method: "POST",
        },
        timeoutMs,
      );
    },
    async getBlockHeaders(hashes): Promise<unknown> {
      return requestJson(
        fetchImpl,
        new URL("block-headers", baseUrl),
        {
          body: JSON.stringify({ hashes }),
          headers: { accept: "application/json", "content-type": "application/json" },
          method: "POST",
        },
        timeoutMs,
      );
    },
    async submitTransaction(input) {
      const expectedTransactionId = transactionIdSchema.parse(
        input.expectedTransactionId.trim().toLowerCase(),
      );
      if (typeof input.transactionSafeJson !== "string" || input.transactionSafeJson.length === 0) {
        throw new KaspaVspcError("VSPC_CONFIG_ERROR", "Prepared transaction SafeJSON is required.");
      }
      const payload = await requestJson(
        fetchImpl,
        new URL("submit", baseUrl),
        {
          body: JSON.stringify({
            expectedTransactionId,
            transactionSafeJson: input.transactionSafeJson,
          }),
          headers: { accept: "application/json", "content-type": "application/json" },
          method: "POST",
        },
        timeoutMs,
      );
      const parsed = submitResponseSchema.safeParse(payload);
      if (
        !parsed.success ||
        parsed.data.localTransactionId !== expectedTransactionId ||
        parsed.data.submittedTransactionId !== expectedTransactionId
      ) {
        throw new KaspaVspcError(
          "VSPC_PARSE_ERROR",
          "Kaspa relay returned a mismatched transaction ID.",
        );
      }
      return parsed.data;
    },
  };
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      /^\d+$/u.test(declaredLength) &&
      Number(declaredLength) > MAX_RESPONSE_BYTES
    ) {
      throw new KaspaVspcError("VSPC_PARSE_ERROR", "Kaspa relay response is too large.");
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new KaspaVspcError("VSPC_PARSE_ERROR", "Kaspa relay response is too large.");
    }
    if (!response.ok) {
      throw new KaspaVspcError(
        "VSPC_RPC_ERROR",
        `Internal Kaspa relay rejected the request with status ${response.status}.`,
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new KaspaVspcError("VSPC_PARSE_ERROR", "Kaspa relay returned invalid JSON.", {
        cause: error,
      });
    }
  } catch (error) {
    if (error instanceof KaspaVspcError) throw error;
    const timedOut = error instanceof Error && error.name === "AbortError";
    throw new KaspaVspcError(
      "VSPC_RPC_ERROR",
      timedOut ? "Kaspa relay request timed out." : "Kaspa relay request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeRelayUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new KaspaVspcError("VSPC_CONFIG_ERROR", "Kaspa relay URL is invalid.", {
      cause: error,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new KaspaVspcError("VSPC_CONFIG_ERROR", "Kaspa relay URL must use HTTP or HTTPS.");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
