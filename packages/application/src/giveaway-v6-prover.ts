import { createHash } from "node:crypto";

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
    compactProofHex: z
      .string()
      .regex(/^(?:[0-9a-f]{2})+$/u)
      .max(500_000),
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
        if (!response.ok) throw new Error(`Entropy prover rejected the job (${response.status}).`);
        const parsed = responseSchema.safeParse(JSON.parse(text) as unknown);
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
      } finally {
        clearTimeout(timeout);
      }
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
  const shards = input.snapshot.shards.map((shard) => ({
    count: shard.finalizedEntryCount,
    entriesRootHex: shard.entriesRootHex,
    addressRootHex: shard.addressRootHex,
  }));
  const publicCommitment = JSON.stringify({
    giveawayIdHex: input.config.giveawayIdHex,
    frozenRootHex: input.snapshot.frozenRootHex,
    entropyTargetBlueScore: input.config.entropyTargetBlueScore.toString(),
    shards,
  });
  return {
    jobKey: createHash("sha256").update(publicCommitment).digest("hex"),
    giveawayIdHex: input.config.giveawayIdHex,
    frozenRootHex: input.snapshot.frozenRootHex,
    frozenEntryCount: input.snapshot.frozenEntryCount,
    entropyTargetBlueScore: input.config.entropyTargetBlueScore.toString(),
    shards,
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
