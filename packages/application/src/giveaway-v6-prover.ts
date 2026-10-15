import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";

import { z } from "zod";

import type {
  GiveawayV6ReconstructionConfig,
  GiveawayV6ReconstructionSnapshot,
} from "@kaspa-actions/kaspa-indexer";

import type { GiveawayV6EntropyBoundary } from "./giveaway-v6-settlement.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 600_000;
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const u64Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .transform((value) => BigInt(value));
const pendingSchema = z
  .object({ status: z.literal("pending"), retryAfterSeconds: z.number().int().min(5).max(300) })
  .strict();
const readySchema = z
  .object({
    status: z.literal("ready"),
    compactProofHex: z.string().regex(/^[0-9a-f]{256}$/u),
    parentBlockHashHex: hashSchema,
    parentBlueScore: u64Schema,
    parentSequenceCommitmentHex: hashSchema,
    candidateBlockHashHex: hashSchema,
    candidateBlueScore: u64Schema,
    candidateSequenceCommitmentHex: hashSchema,
  })
  .strict();
const responseSchema = z.discriminatedUnion("status", [pendingSchema, readySchema]);

export type GiveawayV6EntropyProofRequest = {
  config: GiveawayV6ReconstructionConfig;
  snapshot: GiveawayV6ReconstructionSnapshot;
};

export type GiveawayV6EntropyProofResult =
  | { status: "pending"; retryAfterSeconds: number }
  | { status: "ready"; compactProofHex: string; entropy: GiveawayV6EntropyBoundary };

export type GiveawayV6EntropyProver = {
  requestProof(input: GiveawayV6EntropyProofRequest): Promise<GiveawayV6EntropyProofResult>;
};

export function createGiveawayV6EntropyProverClient(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): GiveawayV6EntropyProver {
  const baseUrl = normalizeUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new Error("No fetch implementation is available for the entropy prover.");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("Entropy prover timeout must be between 1000 and 120000 milliseconds.");
  }
  return {
    async requestProof(input) {
      const body = buildRequest(input);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(new URL("prove", baseUrl), {
          body: JSON.stringify(body),
          headers: { accept: "application/json", "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const declaredLength = response.headers.get("content-length");
        if (declaredLength && Number(declaredLength) > MAX_RESPONSE_BYTES) {
          throw new Error("Entropy prover response is too large.");
        }
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
          throw new Error("Entropy prover response is too large.");
        }
        return decodeResponse(response.status, text);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/** Connects the container to a Mac prover through a private SSH-forwarded Unix socket. */
export function createGiveawayV6EntropyProverSocketClient(options: {
  socketPath: string;
  timeoutMs?: number;
}): GiveawayV6EntropyProver {
  if (!options.socketPath.startsWith("/") || options.socketPath.includes("\0")) {
    throw new Error("Entropy prover socket path must be absolute.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("Entropy prover timeout must be between 1000 and 120000 milliseconds.");
  }
  return {
    async requestProof(input) {
      const body = JSON.stringify(buildRequest(input));
      return new Promise<GiveawayV6EntropyProofResult>((resolve, reject) => {
        const request = httpRequest(
          {
            socketPath: options.socketPath,
            path: "/prove",
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
          },
          (response) => {
            const declaredLength = response.headers["content-length"];
            if (declaredLength && Number(declaredLength) > MAX_RESPONSE_BYTES) {
              response.destroy();
              reject(new Error("Entropy prover response is too large."));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_RESPONSE_BYTES) {
                response.destroy();
                reject(new Error("Entropy prover response is too large."));
              } else chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", () => {
              try {
                resolve(decodeResponse(response.statusCode ?? 0, Buffer.concat(chunks).toString("utf8")));
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        request.setTimeout(timeoutMs, () => request.destroy(new Error("Entropy prover timed out.")));
        request.on("error", reject);
        request.end(body);
      });
    },
  };
}

function decodeResponse(status: number, text: string): GiveawayV6EntropyProofResult {
  if (status < 200 || status >= 300) throw new Error(`Entropy prover rejected the job (${status}).`);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Entropy prover returned invalid JSON.");
  }
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new Error("Entropy prover returned an invalid response.");
  if (parsed.data.status === "pending") return parsed.data;
  return {
    status: "ready",
    compactProofHex: parsed.data.compactProofHex,
    entropy: {
      parentBlockHashHex: parsed.data.parentBlockHashHex,
      parentBlueScore: parsed.data.parentBlueScore,
      parentSequenceCommitmentHex: parsed.data.parentSequenceCommitmentHex,
      candidateBlockHashHex: parsed.data.candidateBlockHashHex,
      candidateBlueScore: parsed.data.candidateBlueScore,
      candidateSequenceCommitmentHex: parsed.data.candidateSequenceCommitmentHex,
    },
  };
}

function buildRequest(input: GiveawayV6EntropyProofRequest) {
  if (
    input.snapshot.phase !== "frozen" ||
    input.snapshot.frozenRootHex === null ||
    input.snapshot.frozenEntryCount === null ||
    input.snapshot.frozenEntryCount === 0
  ) {
    throw new Error("Entropy proof requires a non-empty frozen Giveaway V6 state.");
  }
  return giveawayV6EntropyProofJob(input.config.entropyTargetBlueScore);
}

/**
 * The proof attests only which selected-chain block first crosses the target,
 * so the job is keyed by the target alone. Every Giveaway committed to the
 * same draw slot shares the target, so the prover runs once per slot and hands
 * the same receipt to each of them. Empty and unfrozen Giveaways never ask.
 */
export function giveawayV6EntropyProofJob(entropyTargetBlueScore: bigint) {
  const target = entropyTargetBlueScore.toString();
  return {
    jobKey: createHash("sha256")
      .update(JSON.stringify({ entropyTargetBlueScore: target }))
      .digest("hex"),
    entropyTargetBlueScore: target,
  };
}

function normalizeUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Entropy prover URL is invalid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Entropy prover URL must use HTTP or HTTPS.");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
