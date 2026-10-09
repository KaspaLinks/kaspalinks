import { z } from "zod";

const MAX_U64 = (1n << 64n) - 1n;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CONFIRMATIONS = 10;

export type KaspaVspcErrorCode =
  | "VSPC_CONFIG_ERROR"
  | "VSPC_NETWORK_ERROR"
  | "VSPC_PARSE_ERROR"
  | "VSPC_RPC_ERROR";

export class KaspaVspcError extends Error {
  readonly code: KaspaVspcErrorCode;

  constructor(code: KaspaVspcErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KaspaVspcError";
    this.code = code;
  }
}

export type KaspaVspcV2Client = {
  getCurrentNetwork(request?: null): Promise<unknown>;
  getVirtualChainFromBlockV2(request: {
    startHash: string;
    dataVerbosityLevel: "Full";
    minConfirmationCount: number;
  }): Promise<unknown>;
};

export type ReadKaspaVspcV2PageOptions = {
  startHash: string;
  expectedNetwork?: "mainnet" | "testnet-10";
  minConfirmationCount?: number;
  timeoutMs?: number;
};

export type KaspaVspcHeader = {
  hash: string;
  directParentHashes: readonly string[];
  selectedParentHash: string;
  acceptedIdMerkleRoot: string;
  daaScore: bigint;
  blueScore: bigint;
};

export type KaspaVspcUtxo = {
  amountSompi: bigint;
  scriptPublicKeyHex: string;
  blockDaaScore: bigint;
  covenantIdHex: string | null;
  isCoinbase: boolean;
};

export type KaspaVspcInput = {
  previousOutpoint: { transactionId: string; outputIndex: number };
  signatureScriptHex: string;
  sequence: bigint;
  computeBudget: number | null;
  utxo: KaspaVspcUtxo;
};

export type KaspaVspcOutput = {
  outputIndex: number;
  amountSompi: bigint;
  scriptPublicKeyHex: string;
  covenant: { authorizingInput: number; covenantIdHex: string } | null;
};

export type KaspaVspcAcceptedTransaction = {
  transactionId: string;
  version: number;
  acceptingBlockHash: string;
  acceptingDaaScore: bigint;
  inputs: readonly KaspaVspcInput[];
  outputs: readonly KaspaVspcOutput[];
};

export type KaspaVspcAcceptedBlock = {
  header: KaspaVspcHeader;
  acceptedTransactions: readonly KaspaVspcAcceptedTransaction[];
};

export type KaspaVspcV2Page = {
  network: "mainnet" | "testnet-10";
  removedChainBlockHashes: readonly string[];
  addedChainBlockHashes: readonly string[];
  blocks: readonly KaspaVspcAcceptedBlock[];
};

const hashSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/u)
  .transform((value) => value.toLowerCase());

function boundedHexSchema(maximumLength: number) {
  return z
    .string()
    .max(maximumLength)
    .regex(/^(?:[0-9a-fA-F]{2})*$/u)
    .transform((value) => value.toLowerCase());
}

const u64Schema = z.union([
  z.bigint().min(0n).max(MAX_U64),
  z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/u)
    .transform((value, context) => {
      const parsed = BigInt(value);
      if (parsed > MAX_U64) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Value exceeds uint64." });
        return z.NEVER;
      }
      return parsed;
    }),
]);

const outputIndexSchema = z.number().int().min(0).max(0xffffffff);
const scriptVersionSchema = z.number().int().min(0).max(0xffff);

const scriptPublicKeySchema = z.union([
  boundedHexSchema(2_000_004).refine((value) => value.length >= 4),
  z.object({ version: scriptVersionSchema, script: boundedHexSchema(2_000_000) }),
]);

const covenantSchema = z
  .object({
    authorizingInput: z.number().int().min(0).max(0xffff),
    covenantId: hashSchema,
  })
  .nullable()
  .optional();

const utxoSchema = z.object({
  amount: u64Schema,
  scriptPublicKey: scriptPublicKeySchema,
  blockDaaScore: u64Schema,
  isCoinbase: z.boolean(),
  covenantId: hashSchema.nullable().optional(),
});

const inputSchema = z.object({
  previousOutpoint: z.object({ transactionId: hashSchema, index: outputIndexSchema }),
  signatureScript: boundedHexSchema(500_000),
  sequence: u64Schema,
  computeBudget: z.number().int().min(0).max(0xffff).optional(),
  verboseData: z.object({ utxoEntry: utxoSchema }),
});

const outputSchema = z.object({
  value: u64Schema,
  scriptPublicKey: scriptPublicKeySchema,
  covenant: covenantSchema,
});

const transactionSchema = z.object({
  version: z.number().int().min(0).max(0xffff),
  inputs: z.array(inputSchema).min(1),
  outputs: z.array(outputSchema).min(1),
  verboseData: z.object({ transactionId: hashSchema }),
});

const headerSchema = z.object({
  hash: hashSchema,
  parentsByLevel: z.unknown(),
  acceptedIdMerkleRoot: hashSchema,
  daaScore: u64Schema,
  blueScore: u64Schema,
});

const responseSchema = z.object({
  removedChainBlockHashes: z.array(hashSchema),
  addedChainBlockHashes: z.array(hashSchema),
  chainBlockAcceptedTransactions: z.array(
    z.object({
      chainBlockHeader: headerSchema,
      acceptedTransactions: z.array(transactionSchema),
    }),
  ),
});

/**
 * Reads one confirmed selected-chain page using rusty-kaspa's VSPC v2 Full
 * response. The returned facts contain no wallet material and are sufficient
 * for a separate SilverScript ABI decoder.
 */
export async function readKaspaVspcV2Page(
  client: KaspaVspcV2Client,
  options: ReadKaspaVspcV2PageOptions,
): Promise<KaspaVspcV2Page> {
  const startHash = parseHash(options.startHash, "start hash", "VSPC_CONFIG_ERROR");
  const expectedNetwork = options.expectedNetwork ?? "mainnet";
  const minConfirmationCount = options.minConfirmationCount ?? DEFAULT_CONFIRMATIONS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(minConfirmationCount) ||
    minConfirmationCount < 1 ||
    minConfirmationCount > 100_000
  ) {
    fail(
      "VSPC_CONFIG_ERROR",
      "Minimum confirmation count must be an integer from 1 through 100000.",
    );
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000) {
    fail("VSPC_CONFIG_ERROR", "VSPC timeout must be between 250 and 120000 milliseconds.");
  }

  let networkResponse: unknown;
  try {
    networkResponse = await withTimeout(client.getCurrentNetwork(null), timeoutMs, "network check");
  } catch (error) {
    throw wrapRpcError("Kaspa VSPC network check failed.", error);
  }
  const network = z
    .object({ network: z.enum(["mainnet", "testnet-10"]) })
    .safeParse(networkResponse);
  if (!network.success) fail("VSPC_PARSE_ERROR", "Kaspa RPC returned an invalid network response.");
  if (network.data.network !== expectedNetwork) {
    fail(
      "VSPC_NETWORK_ERROR",
      `Kaspa RPC network does not match the configured ${expectedNetwork} network.`,
    );
  }

  let response: unknown;
  try {
    response = await withTimeout(
      client.getVirtualChainFromBlockV2({
        startHash,
        dataVerbosityLevel: "Full",
        minConfirmationCount,
      }),
      timeoutMs,
      "VSPC page",
    );
  } catch (error) {
    throw wrapRpcError("Kaspa VSPC page request failed.", error);
  }
  return normalizeResponse(network.data.network, response);
}

function normalizeResponse(network: "mainnet" | "testnet-10", value: unknown): KaspaVspcV2Page {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success)
    fail("VSPC_PARSE_ERROR", "Kaspa VSPC Full response is missing required chain data.");
  const added = new Set(parsed.data.addedChainBlockHashes);
  if (added.size !== parsed.data.addedChainBlockHashes.length) {
    fail("VSPC_PARSE_ERROR", "Kaspa VSPC response contains duplicate added-chain block hashes.");
  }
  if (parsed.data.chainBlockAcceptedTransactions.length !== added.size) {
    fail(
      "VSPC_PARSE_ERROR",
      "Kaspa VSPC response does not include one Full record per added-chain block.",
    );
  }

  const seenBlocks = new Set<string>();
  const seenTransactions = new Set<string>();
  const blocks = parsed.data.chainBlockAcceptedTransactions.map((block) => {
    const header = normalizeHeader(block.chainBlockHeader);
    if (!added.has(header.hash) || seenBlocks.has(header.hash)) {
      fail("VSPC_PARSE_ERROR", "Kaspa VSPC Full records do not match the added-chain block set.");
    }
    seenBlocks.add(header.hash);
    const acceptedTransactions = block.acceptedTransactions.map((transaction) => {
      const transactionId = transaction.verboseData.transactionId;
      if (seenTransactions.has(transactionId)) {
        fail("VSPC_PARSE_ERROR", "Kaspa VSPC page contains a duplicate accepted transaction.");
      }
      seenTransactions.add(transactionId);
      return {
        transactionId,
        version: transaction.version,
        acceptingBlockHash: header.hash,
        acceptingDaaScore: header.daaScore,
        inputs: transaction.inputs.map((input) => ({
          previousOutpoint: {
            transactionId: input.previousOutpoint.transactionId,
            outputIndex: input.previousOutpoint.index,
          },
          signatureScriptHex: input.signatureScript,
          sequence: input.sequence,
          computeBudget: input.computeBudget ?? null,
          utxo: {
            amountSompi: input.verboseData.utxoEntry.amount,
            scriptPublicKeyHex: serializeScriptPublicKey(
              input.verboseData.utxoEntry.scriptPublicKey,
            ),
            blockDaaScore: input.verboseData.utxoEntry.blockDaaScore,
            covenantIdHex: input.verboseData.utxoEntry.covenantId ?? null,
            isCoinbase: input.verboseData.utxoEntry.isCoinbase,
          },
        })),
        outputs: transaction.outputs.map((output, outputIndex) => ({
          outputIndex,
          amountSompi: output.value,
          scriptPublicKeyHex: serializeScriptPublicKey(output.scriptPublicKey),
          covenant:
            output.covenant === undefined || output.covenant === null
              ? null
              : {
                  authorizingInput: output.covenant.authorizingInput,
                  covenantIdHex: output.covenant.covenantId,
                },
        })),
      } satisfies KaspaVspcAcceptedTransaction;
    });
    return { header, acceptedTransactions };
  });

  return {
    network,
    removedChainBlockHashes: parsed.data.removedChainBlockHashes,
    addedChainBlockHashes: parsed.data.addedChainBlockHashes,
    blocks,
  };
}

function normalizeHeader(input: z.infer<typeof headerSchema>): KaspaVspcHeader {
  const parents = expandParents(input.parentsByLevel);
  const parsedParents = z.array(z.array(hashSchema).min(1)).min(1).safeParse(parents);
  if (!parsedParents.success)
    fail("VSPC_PARSE_ERROR", "Kaspa VSPC block header has invalid parent levels.");
  const directParentHashes = parsedParents.data[0]!;
  return {
    hash: input.hash,
    directParentHashes,
    selectedParentHash: directParentHashes[0]!,
    acceptedIdMerkleRoot: input.acceptedIdMerkleRoot,
    daaScore: input.daaScore,
    blueScore: input.blueScore,
  };
}

function expandParents(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null || !("toExpanded" in value)) return value;
  const expand = value.toExpanded;
  if (typeof expand !== "function") return value;
  try {
    return expand.call(value);
  } catch {
    fail("VSPC_PARSE_ERROR", "Kaspa VSPC compressed parents could not be expanded.");
  }
}

function serializeScriptPublicKey(value: z.infer<typeof scriptPublicKeySchema>): string {
  if (typeof value === "string") return value;
  return value.version.toString(16).padStart(4, "0") + value.script;
}

function parseHash(value: string, label: string, code: KaspaVspcErrorCode): string {
  const result = hashSchema.safeParse(value);
  if (!result.success) fail(code, `Kaspa ${label} must be a 32-byte hex value.`);
  return result.data;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function wrapRpcError(message: string, cause: unknown): KaspaVspcError {
  return new KaspaVspcError("VSPC_RPC_ERROR", message, { cause });
}

function fail(code: KaspaVspcErrorCode, message: string): never {
  throw new KaspaVspcError(code, message);
}
