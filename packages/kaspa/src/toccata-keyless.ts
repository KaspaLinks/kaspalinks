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

export type ToccataKeylessOutput = {
  amountSompi: bigint | string;
  covenant?: { authorizingInput: number; covenantIdHex: string } | null;
  scriptPublicKeyHex: string;
};

export type ToccataKeylessInput = {
  computeBudget: number;
  funding: {
    amountSompi: bigint | string;
    blockDaaScore: bigint | string;
    outputIndex: number;
    scriptPublicKeyHex: string;
    transactionId: string;
  };
  invocationStackHex: readonly string[];
  redeemScriptHex: string;
};

export type ToccataKeylessTransactionInput = {
  computeBudget: number;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  signatureScriptHex: string;
};

export type ToccataKeylessTransaction = {
  computeMass: string;
  feeMass: string;
  feeSompi: string;
  inputs: readonly ToccataKeylessTransactionInput[];
  mass: string;
  minimumFeeSompi: string;
  storageMass: string;
  transactionId: string;
  transactionSafeJson: string;
  transientMass: string;
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

export type ToccataKeylessTransactionBuildInput = {
  feeSompi: bigint | string;
  inputs: readonly ToccataKeylessInput[];
  lockTime?: bigint | string;
  outputs: readonly ToccataKeylessOutput[];
};

/**
 * Builds a keyless covenant transition without signing or broadcasting it.
 * The fee and every output are fixed before the witness is attached.
 */
export function buildToccataKeylessCovenantSpend(
  input: ToccataKeylessCovenantSpendInput,
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataKeylessCovenantSpend {
  const transaction = buildToccataKeylessTransaction(
    {
      feeSompi: input.feeSompi,
      inputs: [
        {
          computeBudget: input.computeBudget,
          funding: input.funding,
          invocationStackHex: input.invocationStackHex,
          redeemScriptHex: input.redeemScriptHex,
        },
      ],
      outputs: input.outputs,
    },
    wasmModule,
  );
  const onlyInput = transaction.inputs[0]!;
  return {
    computeMass: transaction.computeMass,
    computeBudget: onlyInput.computeBudget,
    feeMass: transaction.feeMass,
    feeSompi: transaction.feeSompi,
    fundingAmountSompi: onlyInput.fundingAmountSompi,
    fundingOutputIndex: onlyInput.fundingOutputIndex,
    fundingTransactionId: onlyInput.fundingTransactionId,
    mass: transaction.mass,
    minimumFeeSompi: transaction.minimumFeeSompi,
    signatureScriptHex: onlyInput.signatureScriptHex,
    storageMass: transaction.storageMass,
    transactionId: transaction.transactionId,
    transactionSafeJson: transaction.transactionSafeJson,
    transientMass: transaction.transientMass,
  };
}

/**
 * Builds a keyless covenant transaction with one or more public covenant
 * inputs. Plain terminal outputs are allowed, but every amount, destination,
 * witness and compute commitment is fixed and checked before the result can be
 * submitted to a relay.
 */
export function buildToccataKeylessTransaction(
  input: ToccataKeylessTransactionBuildInput,
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataKeylessTransaction {
  assertToccataSdkReady(wasmModule);
  const feeSompi = parsePositiveU64(input.feeSompi, "fee");
  const lockTime = parseU64(input.lockTime ?? 0n, "lock time");
  if (input.inputs.length === 0 || input.inputs.length > 32) {
    throw new Error("Keyless covenant transaction must contain between 1 and 32 inputs.");
  }
  const inputs = input.inputs.map((candidate, inputIndex) => {
    const fundingTransactionId = normalizeHash(
      candidate.funding.transactionId,
      `input ${inputIndex} funding transaction`,
    );
    const fundingOutputIndex = normalizeOutputIndex(candidate.funding.outputIndex);
    const fundingAmountSompi = parsePositiveU64(
      candidate.funding.amountSompi,
      `input ${inputIndex} funding amount`,
    );
    const fundingBlockDaaScore = parseU64(
      candidate.funding.blockDaaScore,
      `input ${inputIndex} funding block DAA score`,
    );
    const computeBudget = normalizeComputeBudget(candidate.computeBudget);
    const redeemScriptHex = normalizeHex(
      candidate.redeemScriptHex,
      `input ${inputIndex} redeem script`,
      MAX_SIGNATURE_SCRIPT_BYTES,
    );
    const expectedFundingScript = normalizeSerializedScriptPublicKey(
      candidate.funding.scriptPublicKeyHex,
      `input ${inputIndex} funding script public key`,
    );
    const derivedFundingScript = serializeScriptPublicKey(
      wasmModule.payToScriptHashScript(redeemScriptHex).toJSON() as ScriptPublicKeyJson,
    );
    if (derivedFundingScript !== expectedFundingScript) {
      throw new Error("Redeem script does not match the committed funding script public key.");
    }
    if (candidate.invocationStackHex.length === 0 || candidate.invocationStackHex.length > 32) {
      throw new Error("Keyless invocation stack must contain between 1 and 32 items.");
    }
    const invocationStackHex = candidate.invocationStackHex.map((value, stackIndex) =>
      normalizeHex(
        value,
        `input ${inputIndex} invocation stack item ${stackIndex}`,
        MAX_SIGNATURE_SCRIPT_BYTES,
      ),
    );
    const invocation = new wasmModule.ScriptBuilder({ flags: { covenantsEnabled: true } });
    for (const stackItem of invocationStackHex) invocation.addData(stackItem);
    const redeemScript = wasmModule.ScriptBuilder.fromScript(redeemScriptHex, {
      flags: { covenantsEnabled: true },
    });
    const signatureScriptHex = redeemScript.encodePayToScriptHashSignatureScript(
      invocation.drain(),
    );
    if (signatureScriptHex.length / 2 > MAX_SIGNATURE_SCRIPT_BYTES) {
      throw new Error("Keyless covenant signature script exceeds the reviewed size limit.");
    }
    return {
      computeBudget,
      expectedFundingScript,
      fundingAmountSompi,
      fundingBlockDaaScore,
      fundingOutputIndex,
      fundingTransactionId,
      signatureScriptHex,
    };
  });
  if (input.outputs.length === 0 || input.outputs.length > 32) {
    throw new Error("Keyless covenant transaction must contain between 1 and 32 outputs.");
  }
  const outputs = input.outputs.map((output, index) => ({
    amountSompi: parsePositiveU64(output.amountSompi, `output ${index} amount`),
    covenant:
      output.covenant === undefined || output.covenant === null
        ? null
        : {
            authorizingInput: normalizeAuthorizingInput(
              output.covenant.authorizingInput,
              index,
              inputs.length,
            ),
            covenantIdHex: normalizeHash(
              output.covenant.covenantIdHex,
              `output ${index} covenant ID`,
            ),
          },
    scriptPublicKey: parseSerializedScriptPublicKey(
      output.scriptPublicKeyHex,
      `output ${index} script public key`,
    ),
  }));
  const fundingTotal = inputs.reduce(
    (sum, candidate) => checkedAdd(sum, candidate.fundingAmountSompi),
    0n,
  );
  const outputTotal = outputs.reduce((sum, output) => checkedAdd(sum, output.amountSompi), 0n);
  if (checkedAdd(outputTotal, feeSompi) !== fundingTotal) {
    throw new Error("Funding amount must equal the exact covenant outputs plus the fixed fee.");
  }

  const transaction = wasmModule.Transaction.deserializeFromSafeJSON(
    JSON.stringify({
      gas: "0",
      id: "0".repeat(64),
      inputs: inputs.map((candidate) => ({
        computeBudget: candidate.computeBudget,
        index: candidate.fundingOutputIndex,
        sequence: "0",
        sigOpCount: 0,
        signatureScript: "",
        transactionId: candidate.fundingTransactionId,
        utxo: {
          amount: candidate.fundingAmountSompi.toString(),
          blockDaaScore: candidate.fundingBlockDaaScore.toString(),
          isCoinbase: false,
          scriptPublicKey: parseSerializedScriptPublicKey(
            candidate.expectedFundingScript,
            "funding script public key",
          ),
        },
      })),
      lockTime: lockTime.toString(),
      outputs: outputs.map((output) => ({
        ...(output.covenant === null
          ? {}
          : {
              covenant: {
                authorizingInput: output.covenant.authorizingInput,
                covenantId: output.covenant.covenantIdHex,
              },
            }),
        scriptPublicKey: output.scriptPublicKey,
        value: output.amountSompi.toString(),
      })),
      payload: "",
      subnetworkId: ZERO_SUBNETWORK_ID,
      version: 1,
    }),
  );

  transaction.inputs.forEach((transactionInput, index) => {
    transactionInput.signatureScript = inputs[index]!.signatureScriptHex;
  });
  transaction.finalize();

  const masses = calculatePostToccataMass({
    inputs,
    outputs,
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
  if (roundTrip.id !== transaction.id || roundTrip.inputs.length !== inputs.length) {
    throw new Error("Keyless covenant transaction changed during SafeJSON round trip.");
  }
  if (roundTrip.outputs.length !== outputs.length)
    throw new Error("Keyless covenant intent changed during SafeJSON round trip.");
  const roundTripJson = JSON.parse(roundTrip.serializeToSafeJSON()) as TransactionSafeJson;
  roundTrip.inputs.forEach((serializedInput, index) => {
    const expected = inputs[index]!;
    const jsonInput = roundTripJson.inputs[index];
    if (
      serializedInput.computeBudget !== expected.computeBudget ||
      serializedInput.signatureScript !== expected.signatureScriptHex ||
      serializedInput.previousOutpoint.transactionId !== expected.fundingTransactionId ||
      serializedInput.previousOutpoint.index !== expected.fundingOutputIndex ||
      !jsonInput ||
      jsonInput.utxo.amount !== expected.fundingAmountSompi.toString() ||
      jsonInput.utxo.blockDaaScore !== expected.fundingBlockDaaScore.toString() ||
      jsonInput.utxo.isCoinbase !== false ||
      jsonInput.utxo.scriptPublicKey !== expected.expectedFundingScript
    ) {
      throw new Error(`Keyless covenant input ${index} changed during SafeJSON round trip.`);
    }
  });
  roundTripJson.outputs.forEach((actual, index) => {
    const expected = outputs[index]!;
    if (
      actual.value !== expected.amountSompi.toString() ||
      actual.scriptPublicKey !== serializeScriptPublicKey(expected.scriptPublicKey) ||
      (expected.covenant === null
        ? actual.covenant !== undefined && actual.covenant !== null
        : actual.covenant?.authorizingInput !== expected.covenant.authorizingInput ||
          actual.covenant?.covenantId !== expected.covenant.covenantIdHex)
    ) {
      throw new Error(`Keyless covenant output ${index} changed during SafeJSON round trip.`);
    }
  });

  return {
    computeMass: masses.computeMass.toString(),
    feeMass: masses.feeMass.toString(),
    feeSompi: feeSompi.toString(),
    inputs: inputs.map((candidate) => ({
      computeBudget: candidate.computeBudget,
      fundingAmountSompi: candidate.fundingAmountSompi.toString(),
      fundingOutputIndex: candidate.fundingOutputIndex,
      fundingTransactionId: candidate.fundingTransactionId,
      signatureScriptHex: candidate.signatureScriptHex,
    })),
    mass: masses.normalizedMass.toString(),
    minimumFeeSompi: minimumFeeSompi.toString(),
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
    covenant?: { authorizingInput: number; covenantId: string } | null;
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

function normalizeAuthorizingInput(value: number, outputIndex: number, inputCount: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= inputCount || value > 0xffff) {
    if (inputCount === 1) {
      throw new Error(
        `output ${outputIndex} authorizing input must reference the only transaction input at index zero.`,
      );
    }
    throw new Error(`output ${outputIndex} authorizing input must reference a transaction input.`);
  }
  return value;
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

export type PostToccataTransactionShape = {
  inputs: readonly { signatureScriptBytes: number; computeBudget: number }[];
  outputs: readonly { scriptPublicKeyBytes: number; covenant: boolean }[];
};

/**
 * Compute and transient mass of a version-1 transaction from its shape alone.
 * Keyless covenants commit their fee before the transaction exists, so this
 * lets a creator check that fee against the relay minimum in advance.
 */
export function estimatePostToccataFeeMass(shape: PostToccataTransactionShape) {
  const transactionSize =
    2n +
    8n +
    shape.inputs.reduce(
      (sum, input) => sum + 32n + 4n + 8n + BigInt(input.signatureScriptBytes) + 8n + 2n,
      0n,
    ) +
    8n +
    shape.outputs.reduce(
      (sum, output) =>
        sum +
        8n +
        2n +
        8n +
        BigInt(output.scriptPublicKeyBytes) +
        (output.covenant ? 2n + 32n : 0n),
      0n,
    ) +
    8n +
    20n +
    8n +
    32n +
    8n;
  const outputScriptMass = shape.outputs.reduce(
    (sum, output) => sum + (2n + BigInt(output.scriptPublicKeyBytes)) * 10n,
    0n,
  );
  const computeMass =
    transactionSize +
    outputScriptMass +
    shape.inputs.reduce((sum, input) => sum + BigInt(input.computeBudget) * 100n, 0n);
  const transientMass = transactionSize * 4n;
  const feeMass = maxBigInt(computeMass, divideCeil(transientMass, 2n));
  return {
    computeMass,
    feeMass,
    minimumFeeSompi: maxBigInt(
      feeMass * MINIMUM_RELAY_FEE_SOMPI_PER_GRAM,
      MINIMUM_RELAY_FEE_FLOOR_SOMPI,
    ),
    transientMass,
  };
}

function calculatePostToccataMass(input: {
  inputs: readonly {
    computeBudget: number;
    expectedFundingScript: string;
    fundingAmountSompi: bigint;
    signatureScriptHex: string;
  }[];
  outputs: readonly {
    amountSompi: bigint;
    covenant: { authorizingInput: number; covenantIdHex: string } | null;
    scriptPublicKey: ScriptPublicKeyJson;
  }[];
}) {
  const outputScriptBytes = input.outputs.map((output) =>
    BigInt(output.scriptPublicKey.script.length / 2),
  );
  const { computeMass, transientMass } = estimatePostToccataFeeMass({
    inputs: input.inputs.map((candidate) => ({
      computeBudget: candidate.computeBudget,
      signatureScriptBytes: candidate.signatureScriptHex.length / 2,
    })),
    outputs: input.outputs.map((output) => ({
      covenant: output.covenant !== null,
      scriptPublicKeyBytes: output.scriptPublicKey.script.length / 2,
    })),
  });
  const normalizedTransientMass = divideCeil(transientMass, 2n);
  const storageMass = calculateStorageMass({
    inputs: input.inputs.map((candidate) => ({
      amountSompi: candidate.fundingAmountSompi,
      scriptBytes: BigInt((candidate.expectedFundingScript.length - 4) / 2),
    })),
    outputs: input.outputs.map((output, index) => ({
      amountSompi: output.amountSompi,
      covenantBytes: output.covenant === null ? 0n : 32n,
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
  inputs: readonly { amountSompi: bigint; scriptBytes: bigint }[];
  outputs: readonly { amountSompi: bigint; covenantBytes: bigint; scriptBytes: bigint }[];
}): bigint {
  const inputCells = input.inputs.map((candidate) => ({
    amountSompi: candidate.amountSompi,
    plurality: divideCeil(63n + candidate.scriptBytes, 100n),
  }));
  const inputPlurality = inputCells.reduce((sum, candidate) => sum + candidate.plurality, 0n);
  const outputCells = input.outputs.map((output) => ({
    amountSompi: output.amountSompi,
    plurality: divideCeil(63n + output.scriptBytes + output.covenantBytes, 100n),
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
    const harmonicInput = inputCells.reduce(
      (sum, candidate) =>
        sum +
        (STORAGE_MASS_PARAMETER * candidate.plurality * candidate.plurality) /
          candidate.amountSompi,
      0n,
    );
    return harmonicOutputs > harmonicInput ? harmonicOutputs - harmonicInput : 0n;
  }
  const fundingTotal = inputCells.reduce((sum, candidate) => sum + candidate.amountSompi, 0n);
  const inputMean = maxBigInt(fundingTotal / inputPlurality, 1n);
  const arithmeticInput = inputPlurality * (STORAGE_MASS_PARAMETER / inputMean);
  return harmonicOutputs > arithmeticInput ? harmonicOutputs - arithmeticInput : 0n;
}

function divideCeil(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
