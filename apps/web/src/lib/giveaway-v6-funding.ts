import type { GiveawayV6ConfirmedFunding } from "@kaspa-actions/application";
import { z } from "zod";

const HASH_PATTERN = /^[0-9a-f]{64}$/iu;
const P2SH_SCRIPT_PATTERN = /^0000aa20[0-9a-f]{64}87$/iu;
const RAW_SCRIPT_PATTERN = /^(?:[0-9a-f]{2})+$/iu;
const MAX_U64 = (1n << 64n) - 1n;
const MAX_RESPONSE_CHARACTERS = 2_000_000;
const REQUEST_TIMEOUT_MS = 7_000;

const decimalSchema = z
  .union([z.string().regex(/^[0-9]+$/u), z.number().int().nonnegative().safe()])
  .transform(String);
const hashSchema = z
  .string()
  .regex(HASH_PATTERN)
  .transform((value) => value.toLowerCase());
const rawScriptSchema = z
  .string()
  .regex(RAW_SCRIPT_PATTERN)
  .max(500_000)
  .transform((value) => value.toLowerCase());

const utxoResponseSchema = z
  .array(
    z
      .object({
        outpoint: z.object({
          index: z.number().int().min(0).max(0xffffffff),
          transactionId: hashSchema,
        }),
        utxoEntry: z.object({
          amount: decimalSchema,
          blockDaaScore: decimalSchema,
          isCoinbase: z.boolean(),
          scriptPublicKey: z.object({ scriptPublicKey: rawScriptSchema }).passthrough(),
        }),
      })
      .passthrough(),
  )
  .max(1_000);

const transactionResponseSchema = z
  .object({
    accepting_block_hash: hashSchema.nullable().optional(),
    is_accepted: z.boolean().nullable().optional(),
    outputs: z
      .array(
        z
          .object({
            amount: decimalSchema,
            covenant_authorizing_input: z.number().int().nonnegative().nullable().optional(),
            covenant_id: hashSchema.nullable().optional(),
            index: z.number().int().min(0).max(0xffffffff),
            script_public_key: rawScriptSchema.nullable(),
          })
          .passthrough(),
      )
      .max(10_000),
    transaction_id: hashSchema,
  })
  .passthrough();

export type GiveawayV6FundingLookupResult =
  | { status: "confirmed"; funding: GiveawayV6ConfirmedFunding }
  | { status: "not_found" | "pending" };

export class GiveawayV6FundingLookupError extends Error {
  readonly code: "AMBIGUOUS_FUNDING" | "INVALID_CHAIN_DATA" | "INVALID_INPUT" | "UPSTREAM";

  constructor(
    code: "AMBIGUOUS_FUNDING" | "INVALID_CHAIN_DATA" | "INVALID_INPUT" | "UPSTREAM",
    message: string,
  ) {
    super(message);
    this.name = "GiveawayV6FundingLookupError";
    this.code = code;
  }
}

/**
 * Finds one exact, accepted and still-unspent ordinary funding output.
 * A transaction lookup independently confirms the output has no covenant.
 */
export async function readGiveawayV6ConfirmedFunding(input: {
  expectedFundingSompi: bigint;
  fundingAddress: string;
  fundingScriptPublicKeyHex: string;
}): Promise<GiveawayV6FundingLookupResult> {
  const expected = validateInput(input);
  const utxos = parseChainData(
    utxoResponseSchema,
    await readMainnetJson(`/addresses/${encodeURIComponent(expected.fundingAddress)}/utxos`),
  );
  const matches = utxos.filter(
    (row) =>
      !row.utxoEntry.isCoinbase &&
      BigInt(row.utxoEntry.amount) === expected.expectedFundingSompi &&
      row.utxoEntry.scriptPublicKey.scriptPublicKey === expected.rawScriptPublicKeyHex,
  );

  if (matches.length === 0) return { status: "not_found" };
  if (matches.length !== 1) {
    throw new GiveawayV6FundingLookupError(
      "AMBIGUOUS_FUNDING",
      "More than one exact Giveaway V6 funding output is currently unspent.",
    );
  }

  const match = matches[0]!;
  const transaction = parseChainData(
    transactionResponseSchema,
    await readMainnetJson(`/transactions/${match.outpoint.transactionId}`),
  );
  if (transaction.transaction_id !== match.outpoint.transactionId) {
    invalidChainData("Funding transaction identity does not match its UTXO.");
  }
  if (transaction.is_accepted !== true || !transaction.accepting_block_hash) {
    return { status: "pending" };
  }

  const outputs = transaction.outputs.filter((output) => output.index === match.outpoint.index);
  if (outputs.length !== 1) {
    invalidChainData("Funding transaction does not contain one exact indexed output.");
  }
  const output = outputs[0]!;
  if (
    BigInt(output.amount) !== expected.expectedFundingSompi ||
    output.script_public_key !== expected.rawScriptPublicKeyHex
  ) {
    invalidChainData("Funding transaction output disagrees with the unspent output.");
  }
  if (output.covenant_id != null || output.covenant_authorizing_input != null) {
    invalidChainData("Giveaway V6 funding must be an ordinary output without a covenant.");
  }

  const blockDaaScore = BigInt(match.utxoEntry.blockDaaScore);
  if (blockDaaScore > MAX_U64) invalidChainData("Funding block DAA score exceeds uint64.");

  return {
    status: "confirmed",
    funding: {
      acceptingBlockHash: transaction.accepting_block_hash,
      amountSompi: expected.expectedFundingSompi,
      blockDaaScore,
      covenantIdHex: null,
      outputIndex: match.outpoint.index,
      scriptPublicKeyHex: expected.serializedScriptPublicKeyHex,
      transactionId: match.outpoint.transactionId,
    },
  };
}

function validateInput(input: {
  expectedFundingSompi: bigint;
  fundingAddress: string;
  fundingScriptPublicKeyHex: string;
}) {
  const fundingAddress = input.fundingAddress.trim().toLowerCase();
  const serializedScriptPublicKeyHex = input.fundingScriptPublicKeyHex.trim().toLowerCase();
  if (!/^kaspa:[a-z0-9]{20,190}$/u.test(fundingAddress)) {
    invalidInput("Funding address must be a bounded Kaspa Mainnet address.");
  }
  if (!P2SH_SCRIPT_PATTERN.test(serializedScriptPublicKeyHex)) {
    invalidInput("Funding script must be a serialized version-zero P2SH script.");
  }
  if (
    typeof input.expectedFundingSompi !== "bigint" ||
    input.expectedFundingSompi <= 0n ||
    input.expectedFundingSompi > MAX_U64
  ) {
    invalidInput("Expected funding amount must fit positive uint64 sompi.");
  }
  return {
    expectedFundingSompi: input.expectedFundingSompi,
    fundingAddress,
    rawScriptPublicKeyHex: serializedScriptPublicKeyHex.slice(4),
    serializedScriptPublicKeyHex,
  };
}

async function readMainnetJson(path: string): Promise<unknown> {
  const configured = process.env.KASPA_MAINNET_INDEXER_URL?.trim();
  const baseUrl = (configured || "https://api.kaspa.org").replace(/\/+$/u, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GiveawayV6FundingLookupError(
      "UPSTREAM",
      "Kaspa Mainnet funding data is temporarily unavailable.",
    );
  }
  if (!response.ok) {
    throw new GiveawayV6FundingLookupError(
      "UPSTREAM",
      "Kaspa Mainnet funding data is temporarily unavailable.",
    );
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) {
    invalidChainData("Kaspa Mainnet funding response exceeds the allowed size.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    invalidChainData("Kaspa Mainnet funding response is not valid JSON.");
  }
}

function parseChainData<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) invalidChainData("Kaspa Mainnet funding response has an invalid shape.");
  return parsed.data;
}

function invalidInput(message: string): never {
  throw new GiveawayV6FundingLookupError("INVALID_INPUT", message);
}

function invalidChainData(message: string): never {
  throw new GiveawayV6FundingLookupError("INVALID_CHAIN_DATA", message);
}
