import { createRequire } from "node:module";

import { assertToccataSdkReady } from "./toccata";

type KaspaWasmModule = typeof import("kaspa-wasm");

const MAX_U64 = (1n << 64n) - 1n;
const MAX_SIGNATURE_SCRIPT_BYTES = 250_000;
const MAX_SCRIPT_PUBLIC_KEY_BYTES = 250_000;
const ZERO_SUBNETWORK_ID = "00".repeat(20);
const POST_TOCCATA_COMPUTE_MASS_LIMIT = 500_000n;
const POST_TOCCATA_STORAGE_MASS_LIMIT = 500_000n;
const POST_TOCCATA_TRANSIENT_MASS_LIMIT = 1_000_000n;
const STORAGE_MASS_PARAMETER = 1_000_000_000_000n;
const MINIMUM_RELAY_FEE_SOMPI_PER_GRAM = 100n;
const MINIMUM_RELAY_FEE_FLOOR_SOMPI = 100_000n;

let cachedKaspaWasm: KaspaWasmModule | null = null;

export type ToccataKeylessCovenantOutput = {
  amountSompi: bigint | string;
  covenant: { authorizingInput: number; covenantIdHex: string };
  scriptPublicKeyHex: string;
};

export type ToccataKeylessCovenantSpendInput = {
  computeBudget: number;
  feeSompi: bigint | string;
  funding: {
    amountSompi: bigint | string;
    blockDaaScore: bigint | string;
    outputIndex: number;
    scriptPublicKeyHex: string;
    transactionId: string;
  };
  invocationStackHex: readonly string[];
  outputs: readonly ToccataKeylessCovenantOutput[];
  redeemScriptHex: string;
};

export type ToccataKeylessCovenantSpend = {
  computeMass: string;
  computeBudget: number;
  feeMass: string;
  feeSompi: string;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  mass: string;
  minimumFeeSompi: string;
  signatureScriptHex: string;
  storageMass: string;
  transactionId: string;
  transactionSafeJson: string;
  transientMass: string;
};

/**
 * Builds a keyless covenant transition without signing or broadcasting it.
 * The fee and every output are fixed before the witness is attached.
 */
export function buildToccataKeylessCovenantSpend(
  input: ToccataKeylessCovenantSpendInput,
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataKeylessCovenantSpend {
  assertToccataSdkReady(wasmModule);
  const fundingTransactionId = normalizeHash(input.funding.transactionId, "funding transaction");
  const fundingOutputIndex = normalizeOutputIndex(input.funding.outputIndex);
  const fundingAmountSompi = parsePositiveU64(input.funding.amountSompi, "funding amount");
  const fundingBlockDaaScore = parseU64(input.funding.blockDaaScore, "funding block DAA score");
  const feeSompi = parsePositiveU64(input.feeSompi, "fee");
  const computeBudget = normalizeComputeBudget(input.computeBudget);
  const redeemScriptHex = normalizeHex(
    input.redeemScriptHex,
    "redeem script",
    MAX_SIGNATURE_SCRIPT_BYTES,
  );
  const expectedFundingScript = normalizeSerializedScriptPublicKey(
    input.funding.scriptPublicKeyHex,
    "funding script public key",
  );
  const derivedFundingScript = serializeScriptPublicKey(
    wasmModule.payToScriptHashScript(redeemScriptHex).toJSON() as ScriptPublicKeyJson,
  );
  if (derivedFundingScript !== expectedFundingScript) {
    throw new Error("Redeem script does not match the committed funding script public key.");
  }

  if (input.invocationStackHex.length === 0 || input.invocationStackHex.length > 32) {
    throw new Error("Keyless invocation stack must contain between 1 and 32 items.");
  }
  const invocationStackHex = input.invocationStackHex.map((value, index) =>
    normalizeHex(value, `invocation stack item ${index}`, MAX_SIGNATURE_SCRIPT_BYTES),
  );
  if (input.outputs.length === 0 || input.outputs.length > 32) {
    throw new Error("Keyless covenant spend must contain between 1 and 32 outputs.");
  }
  const outputs = input.outputs.map((output, index) => ({
    amountSompi: parsePositiveU64(output.amountSompi, `output ${index} amount`),
    covenant: {
      authorizingInput: normalizeAuthorizingInput(output.covenant.authorizingInput, index),
      covenantIdHex: normalizeHash(output.covenant.covenantIdHex, `output ${index} covenant ID`),
    },
    scriptPublicKey: parseSerializedScriptPublicKey(
      output.scriptPublicKeyHex,
      `output ${index} script public key`,
    ),
  }));
  const outputTotal = outputs.reduce((sum, output) => checkedAdd(sum, output.amountSompi), 0n);
  if (checkedAdd(outputTotal, feeSompi) !== fundingAmountSompi) {
    throw new Error("Funding amount must equal the exact covenant outputs plus the fixed fee.");
  }

  const transaction = wasmModule.Transaction.deserializeFromSafeJSON(
    JSON.stringify({
      gas: "0",
      id: "0".repeat(64),
      inputs: [
        {
          computeBudget,
          index: fundingOutputIndex,
          sequence: "0",
          sigOpCount: 0,
          signatureScript: "",
          transactionId: fundingTransactionId,
          utxo: {
            amount: fundingAmountSompi.toString(),
            blockDaaScore: fundingBlockDaaScore.toString(),
            isCoinbase: false,
            scriptPublicKey: parseSerializedScriptPublicKey(
              expectedFundingScript,
              "funding script public key",
            ),
          },
        },
      ],
      lockTime: "0",
      outputs: outputs.map((output) => ({
        covenant: {
          authorizingInput: output.covenant.authorizingInput,
          covenantId: output.covenant.covenantIdHex,
        },
        scriptPublicKey: output.scriptPublicKey,
        value: output.amountSompi.toString(),
      })),
      payload: "",
      subnetworkId: ZERO_SUBNETWORK_ID,
      version: 1,
    }),
  );

  const invocation = new wasmModule.ScriptBuilder({ flags: { covenantsEnabled: true } });
  for (const stackItem of invocationStackHex) invocation.addData(stackItem);
  const redeemScript = wasmModule.ScriptBuilder.fromScript(redeemScriptHex, {
    flags: { covenantsEnabled: true },
  });
  const signatureScriptHex = redeemScript.encodePayToScriptHashSignatureScript(invocation.drain());
  if (signatureScriptHex.length / 2 > MAX_SIGNATURE_SCRIPT_BYTES) {
    throw new Error("Keyless covenant signature script exceeds the reviewed size limit.");
  }
  const transactionInput = transaction.inputs[0];
  if (!transactionInput) throw new Error("Could not build the keyless covenant input.");
  transactionInput.signatureScript = signatureScriptHex;
  transaction.finalize();

  const masses = calculatePostToccataMass({
    computeBudget,
    fundingAmountSompi,
    fundingScriptPublicKeyHex: expectedFundingScript,
    outputs,
    signatureScriptHex,
  });
  const minimumFeeSompi = maxBigInt(
    masses.feeMass * MINIMUM_RELAY_FEE_SOMPI_PER_GRAM,
    MINIMUM_RELAY_FEE_FLOOR_SOMPI,
  );
  if (feeSompi < minimumFeeSompi) {
    throw new Error(
      `Fixed keyless covenant fee is below the post-Toccata Mainnet relay minimum of ${minimumFeeSompi} sompi.`,
    );
  }

  const transactionSafeJson = transaction.serializeToSafeJSON();
  const roundTrip = wasmModule.Transaction.deserializeFromSafeJSON(transactionSafeJson);
  if (roundTrip.id !== transaction.id || roundTrip.inputs.length !== 1) {
    throw new Error("Keyless covenant transaction changed during SafeJSON round trip.");
  }
  const serializedInput = roundTrip.inputs[0];
  if (
    !serializedInput ||
    serializedInput.computeBudget !== computeBudget ||
    serializedInput.signatureScript !== signatureScriptHex ||
    serializedInput.previousOutpoint.transactionId !== fundingTransactionId ||
    serializedInput.previousOutpoint.index !== fundingOutputIndex ||
    roundTrip.outputs.length !== outputs.length
  ) {
    throw new Error("Keyless covenant intent changed during SafeJSON round trip.");
  }
  const roundTripJson = JSON.parse(roundTrip.serializeToSafeJSON()) as TransactionSafeJson;
  const jsonInput = roundTripJson.inputs[0];
  if (
    !jsonInput ||
    jsonInput.utxo.amount !== fundingAmountSompi.toString() ||
    jsonInput.utxo.blockDaaScore !== fundingBlockDaaScore.toString() ||
    jsonInput.utxo.isCoinbase !== false ||
    jsonInput.utxo.scriptPublicKey !== expectedFundingScript
  ) {
    throw new Error("Keyless covenant funding UTXO changed during SafeJSON round trip.");
  }
  roundTripJson.outputs.forEach((actual, index) => {
    const expected = outputs[index]!;
    if (
      actual.value !== expected.amountSompi.toString() ||
      actual.scriptPublicKey !== serializeScriptPublicKey(expected.scriptPublicKey) ||
      actual.covenant.authorizingInput !== expected.covenant.authorizingInput ||
      actual.covenant.covenantId !== expected.covenant.covenantIdHex
    ) {
      throw new Error(`Keyless covenant output ${index} changed during SafeJSON round trip.`);
    }
  });

  return {
    computeMass: masses.computeMass.toString(),
    computeBudget,
    feeMass: masses.feeMass.toString(),
    feeSompi: feeSompi.toString(),
    fundingAmountSompi: fundingAmountSompi.toString(),
    fundingOutputIndex,
    fundingTransactionId,
    mass: masses.normalizedMass.toString(),
    minimumFeeSompi: minimumFeeSompi.toString(),
    signatureScriptHex,
    storageMass: masses.storageMass.toString(),
    transactionId: transaction.id,
    transactionSafeJson,
    transientMass: masses.transientMass.toString(),
  };
}

type ScriptPublicKeyJson = { script: string; version: number };
type TransactionSafeJson = {
  inputs: Array<{
    utxo: {
      amount: string;
      blockDaaScore: string;
      isCoinbase: boolean;
      scriptPublicKey: string;
    };
  }>;
  outputs: Array<{
    covenant: { authorizingInput: number; covenantId: string };
    scriptPublicKey: string;
    value: string;
  }>;
};

function loadKaspaWasm(): KaspaWasmModule {
  cachedKaspaWasm ??= createRequire(import.meta.url)("kaspa-wasm") as KaspaWasmModule;
  return cachedKaspaWasm;
}

function normalizeComputeBudget(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff) {
    throw new Error("compute budget must be an integer between 1 and 65535.");
  }
  return value;
}

function normalizeOutputIndex(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("funding output index must be a uint32.");
  }
  return value;
}

function normalizeAuthorizingInput(value: number, outputIndex: number): number {
  if (value !== 0) {
    throw new Error(
      `output ${outputIndex} authorizing input must reference the only transaction input at index zero.`,
    );
  }
  return 0;
}

function parsePositiveU64(value: bigint | string, label: string): bigint {
  const parsed = parseU64(value, label);
  if (parsed === 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function parseU64(value: bigint | string, label: string): bigint {
  const parsed =
    typeof value === "bigint"
      ? value
      : typeof value === "string" && /^[0-9]+$/u.test(value)
        ? BigInt(value)
        : -1n;
  if (parsed < 0n || parsed > MAX_U64) throw new Error(`${label} must fit uint64.`);
  return parsed;
}

function checkedAdd(left: bigint, right: bigint): bigint {
  const result = left + right;
  if (result > MAX_U64) throw new Error("Keyless covenant value sum exceeds uint64.");
  return result;
}

function normalizeHash(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/u.test(normalized)) throw new Error(`${label} must be 32-byte hex.`);
  return normalized;
}

function normalizeHex(value: string, label: string, maxBytes: number): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    !/^(?:[0-9a-f]{2})+$/u.test(normalized) ||
    normalized.length === 0 ||
    normalized.length / 2 > maxBytes
  ) {
    throw new Error(`${label} must be bounded even-length hexadecimal.`);
  }
  return normalized;
}

function normalizeSerializedScriptPublicKey(value: string, label: string): string {
  const normalized = normalizeHex(value, label, MAX_SCRIPT_PUBLIC_KEY_BYTES);
  if (normalized.length < 6) throw new Error(`${label} is too short.`);
  return normalized;
}

function parseSerializedScriptPublicKey(value: string, label: string): ScriptPublicKeyJson {
  const normalized = normalizeSerializedScriptPublicKey(value, label);
  return { script: normalized.slice(4), version: Number.parseInt(normalized.slice(0, 4), 16) };
}

function serializeScriptPublicKey(value: ScriptPublicKeyJson): string {
  return `${value.version.toString(16).padStart(4, "0")}${value.script}`.toLowerCase();
}

function calculatePostToccataMass(input: {
  computeBudget: number;
  fundingAmountSompi: bigint;
  fundingScriptPublicKeyHex: string;
  outputs: readonly {
    amountSompi: bigint;
    scriptPublicKey: ScriptPublicKeyJson;
  }[];
  signatureScriptHex: string;
}) {
  const signatureScriptBytes = BigInt(input.signatureScriptHex.length / 2);
  const outputScriptBytes = input.outputs.map((output) =>
    BigInt(output.scriptPublicKey.script.length / 2),
  );
  const transactionSize =
    2n +
    8n +
    (32n + 4n + 8n + signatureScriptBytes + 8n + 2n) +
    8n +
    outputScriptBytes.reduce(
      (sum, scriptBytes) => sum + 8n + 2n + 8n + scriptBytes + 2n + 32n,
      0n,
    ) +
    8n +
    20n +
    8n +
    32n +
    8n;
  const outputScriptMass = outputScriptBytes.reduce(
    (sum, scriptBytes) => sum + (2n + scriptBytes) * 10n,
    0n,
  );
  const computeMass = transactionSize + outputScriptMass + BigInt(input.computeBudget) * 100n;
  const transientMass = transactionSize * 4n;
  const normalizedTransientMass = divideCeil(transientMass, 2n);
  const storageMass = calculateStorageMass({
    fundingAmountSompi: input.fundingAmountSompi,
    fundingScriptBytes: BigInt((input.fundingScriptPublicKeyHex.length - 4) / 2),
    outputs: input.outputs.map((output, index) => ({
      amountSompi: output.amountSompi,
      scriptBytes: outputScriptBytes[index]!,
    })),
  });
  if (
    computeMass > POST_TOCCATA_COMPUTE_MASS_LIMIT ||
    transientMass > POST_TOCCATA_TRANSIENT_MASS_LIMIT ||
    storageMass > POST_TOCCATA_STORAGE_MASS_LIMIT
  ) {
    throw new Error("Keyless covenant transaction exceeds a post-Toccata Mainnet mass limit.");
  }
  const feeMass = maxBigInt(computeMass, normalizedTransientMass);
  return {
    computeMass,
    feeMass,
    normalizedMass: maxBigInt(feeMass, storageMass),
    storageMass,
    transientMass,
  };
}

function calculateStorageMass(input: {
  fundingAmountSompi: bigint;
  fundingScriptBytes: bigint;
  outputs: readonly { amountSompi: bigint; scriptBytes: bigint }[];
}): bigint {
  const inputPlurality = divideCeil(63n + input.fundingScriptBytes, 100n);
  const outputCells = input.outputs.map((output) => ({
    amountSompi: output.amountSompi,
    plurality: divideCeil(63n + output.scriptBytes + 32n, 100n),
  }));
  const outputPlurality = outputCells.reduce((sum, output) => sum + output.plurality, 0n);
  const harmonicOutputs = outputCells.reduce(
    (sum, output) =>
      sum + (STORAGE_MASS_PARAMETER * output.plurality * output.plurality) / output.amountSompi,
    0n,
  );
  if (
    outputPlurality === 1n ||
    inputPlurality === 1n ||
    (outputPlurality === 2n && inputPlurality === 2n)
  ) {
    const harmonicInput =
      (STORAGE_MASS_PARAMETER * inputPlurality * inputPlurality) / input.fundingAmountSompi;
    return harmonicOutputs > harmonicInput ? harmonicOutputs - harmonicInput : 0n;
  }
  const inputMean = maxBigInt(input.fundingAmountSompi / inputPlurality, 1n);
  const arithmeticInput = inputPlurality * (STORAGE_MASS_PARAMETER / inputMean);
  return harmonicOutputs > arithmeticInput ? harmonicOutputs - arithmeticInput : 0n;
}

function divideCeil(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
