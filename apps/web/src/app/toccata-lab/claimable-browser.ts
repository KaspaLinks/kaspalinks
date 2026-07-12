type BrowserClaimableSpendMode = "claim" | "refund";

export type BrowserClaimableSpendInput = {
  computeBudget?: number;
  destinationAddress: string;
  expectedFundingAddress: string;
  feeSompi: string;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  lockTime?: string;
  mode: BrowserClaimableSpendMode;
  privateKey: string;
  redeemScriptHex: string;
};

export type BrowserClaimableSpend = {
  computeBudget: number;
  destinationAddress: string;
  feeSompi: string;
  fundingAddress: string;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  lockTime: string;
  mode: BrowserClaimableSpendMode;
  network: "mainnet";
  outputAmountSompi: string;
  redeemScriptHex: string;
  signatureScriptHex: string;
  signedInBrowser: true;
  transactionId: string;
  transactionSafeJson: string;
  warning: string;
};

export type BrowserBatchActivationOutput = {
  amountSompi: string;
  redeemScriptHex: string;
};

export type BrowserBatchActivationSpendInput = {
  activationPrivateKey: string;
  computeBudget?: number;
  expectedFundingAddress: string;
  feeSompi: string;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  outputs: BrowserBatchActivationOutput[];
  redeemScriptHex: string;
};

export type BrowserBatchActivationSpend = {
  computeBudget: number;
  feeSompi: string;
  fundingAddress: string;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  outputCount: number;
  signedInBrowser: true;
  transactionId: string;
  transactionSafeJson: string;
  warning: string;
};

type BrowserScriptPublicKey = {
  toJSON(): unknown;
};

type BrowserTransactionInput = {
  signatureScript: string;
};

type BrowserTransaction = {
  finalize(): void;
  id: string;
  inputs: BrowserTransactionInput[];
  serializeToSafeJSON(): string;
};

type BrowserScriptBuilder = {
  addData(data: string): void;
  addI64(value: bigint): void;
  addOp(opcode: unknown): void;
  addOps(opcodes: string): void;
  drain(): string;
};

type KaspaBrowserModule = {
  Opcodes: {
    OpFalse: unknown;
    OpTrue: unknown;
  };
  PrivateKey: new (privateKey: string) => unknown;
  ScriptBuilder: new (options?: unknown) => BrowserScriptBuilder;
  SighashType: {
    All: unknown;
  };
  Transaction: {
    deserializeFromSafeJSON(safeJson: string): BrowserTransaction;
  };
  addressFromScriptPublicKey(
    scriptPublicKey: BrowserScriptPublicKey,
    networkId: "mainnet",
  ): { toString(): string } | null;
  createInputSignature(
    transaction: BrowserTransaction,
    inputIndex: number,
    privateKey: unknown,
    sighashType: unknown,
  ): string;
  default(moduleOrPath?: string): Promise<unknown>;
  payToAddressScript(address: string): BrowserScriptPublicKey;
  payToScriptHashScript(redeemScriptHex: string): BrowserScriptPublicKey;
  payToScriptHashSignatureScript(redeemScriptHex: string, signatureScriptHex: string): string;
  version(): string;
};

const KASPA_WEB_MODULE_URL = "/vendor/kaspa-wasm-v2.0.1/web/kaspa/kaspa.js";
const KASPA_WEB_WASM_URL = "/vendor/kaspa-wasm-v2.0.1/web/kaspa/kaspa_bg.wasm";
const CLAIMABLE_LAB_COMPUTE_BUDGET = 11;
const BATCH_ALLOCATOR_COMPUTE_BUDGET = 30;
const CLAIMABLE_LAB_MIN_OUTPUT_SOMPI = 20_000_000n;

let cachedKaspaBrowserModule: Promise<KaspaBrowserModule> | null = null;

export async function buildClaimableSpendInBrowser(
  input: BrowserClaimableSpendInput,
): Promise<BrowserClaimableSpend> {
  const kaspa = await loadKaspaBrowserModule();
  const mode = normalizeSpendMode(input.mode);
  const privateKey = normalizePrivateKey(input.privateKey);
  const redeemScriptHex = normalizeHex(input.redeemScriptHex, "redeemScriptHex");
  const fundingTransactionId = normalizeTransactionId(input.fundingTransactionId);
  const fundingOutputIndex = normalizeOutputIndex(input.fundingOutputIndex);
  const fundingAmountSompi = parsePositiveBigInt(
    input.fundingAmountSompi,
    "fundingAmountSompi",
  );
  const feeSompi = parsePositiveBigInt(input.feeSompi, "feeSompi");
  const lockTime = parseNonNegativeBigInt(input.lockTime ?? "0", "lockTime");
  const computeBudget = normalizeComputeBudget(input.computeBudget ?? CLAIMABLE_LAB_COMPUTE_BUDGET);
  const destinationAddress = input.destinationAddress.trim();

  if (feeSompi >= fundingAmountSompi) {
    throw new Error("Claim/refund fee must be lower than the funding amount.");
  }

  const outputAmountSompi = fundingAmountSompi - feeSompi;
  if (outputAmountSompi < CLAIMABLE_LAB_MIN_OUTPUT_SOMPI) {
    throw new Error("Claim/refund output must stay at or above the 0.2 KAS floor.");
  }

  const scriptPublicKey = kaspa.payToScriptHashScript(redeemScriptHex);
  const fundingAddress = kaspa.addressFromScriptPublicKey(scriptPublicKey, "mainnet");
  if (!fundingAddress) {
    throw new Error("Could not derive claimable funding address from redeem script.");
  }

  const normalizedFundingAddress = fundingAddress.toString();
  if (input.expectedFundingAddress.trim() !== normalizedFundingAddress) {
    throw new Error("Redeem script does not match the expected funding address.");
  }

  const destinationScriptPublicKey = kaspa.payToAddressScript(destinationAddress);
  const unsignedSafeJson = JSON.stringify({
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
          blockDaaScore: "0",
          isCoinbase: false,
          scriptPublicKey: scriptPublicKey.toJSON(),
        },
      },
    ],
    lockTime: lockTime.toString(),
    outputs: [
      {
        scriptPublicKey: destinationScriptPublicKey.toJSON(),
        value: outputAmountSompi.toString(),
      },
    ],
    payload: "",
    subnetworkId: "00".repeat(20),
    version: 1,
  });
  const transaction = kaspa.Transaction.deserializeFromSafeJSON(unsignedSafeJson);
  const signature = kaspa.createInputSignature(
    transaction,
    0,
    new kaspa.PrivateKey(privateKey),
    kaspa.SighashType.All,
  );
  const innerScript = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  innerScript.addOps(signature);
  innerScript.addOp(mode === "claim" ? kaspa.Opcodes.OpTrue : kaspa.Opcodes.OpFalse);
  const signatureScriptHex = kaspa.payToScriptHashSignatureScript(
    redeemScriptHex,
    innerScript.drain(),
  );
  const transactionInput = transaction.inputs[0];
  if (!transactionInput) {
    throw new Error("Could not build claimable spend input.");
  }
  transactionInput.signatureScript = signatureScriptHex;
  transaction.finalize();

  return {
    computeBudget,
    destinationAddress,
    feeSompi: feeSompi.toString(),
    fundingAddress: normalizedFundingAddress,
    fundingAmountSompi: fundingAmountSompi.toString(),
    fundingOutputIndex,
    fundingTransactionId,
    lockTime: lockTime.toString(),
    mode,
    network: "mainnet",
    outputAmountSompi: outputAmountSompi.toString(),
    redeemScriptHex,
    signatureScriptHex,
    signedInBrowser: true,
    transactionId: transaction.id,
    transactionSafeJson: transaction.serializeToSafeJSON(),
    warning:
      "The claim/refund code was used only in this browser; the server receives signed transaction JSON only if you broadcast.",
  };
}

export async function buildBatchActivationSpendInBrowser(
  input: BrowserBatchActivationSpendInput,
): Promise<BrowserBatchActivationSpend> {
  const kaspa = await loadKaspaBrowserModule();
  const activationPrivateKey = normalizePrivateKey(input.activationPrivateKey);
  const redeemScriptHex = normalizeHex(input.redeemScriptHex, "redeemScriptHex");
  const fundingTransactionId = normalizeTransactionId(input.fundingTransactionId);
  const fundingOutputIndex = normalizeOutputIndex(input.fundingOutputIndex);
  const fundingAmountSompi = parsePositiveBigInt(input.fundingAmountSompi, "fundingAmountSompi");
  const feeSompi = parsePositiveBigInt(input.feeSompi, "feeSompi");
  const computeBudget = normalizeComputeBudget(input.computeBudget ?? BATCH_ALLOCATOR_COMPUTE_BUDGET);

  if (!Array.isArray(input.outputs) || input.outputs.length < 2 || input.outputs.length > 10) {
    throw new Error("Batch activation requires between 2 and 10 child outputs.");
  }

  const outputSpecs = input.outputs.map((output, index) => ({
    amountSompi: parsePositiveBigInt(output.amountSompi, `outputs[${index}].amountSompi`),
    redeemScriptHex: normalizeHex(output.redeemScriptHex, `outputs[${index}].redeemScriptHex`),
  }));
  const totalOutputSompi = outputSpecs.reduce((total, output) => total + output.amountSompi, 0n);
  if (fundingAmountSompi !== totalOutputSompi + feeSompi) {
    throw new Error("Batch funding amount must equal all child outputs plus the activation fee.");
  }

  const scriptPublicKey = kaspa.payToScriptHashScript(redeemScriptHex);
  const fundingAddress = kaspa.addressFromScriptPublicKey(scriptPublicKey, "mainnet");
  if (!fundingAddress) throw new Error("Could not derive batch funding address from redeem script.");
  if (input.expectedFundingAddress.trim() !== fundingAddress.toString()) {
    throw new Error("Batch redeem script does not match the expected funding address.");
  }

  const unsignedSafeJson = JSON.stringify({
    gas: "0",
    id: "0".repeat(64),
    inputs: [{
      computeBudget,
      index: fundingOutputIndex,
      sequence: "0",
      sigOpCount: 0,
      signatureScript: "",
      transactionId: fundingTransactionId,
      utxo: {
        amount: fundingAmountSompi.toString(),
        blockDaaScore: "0",
        isCoinbase: false,
        scriptPublicKey: scriptPublicKey.toJSON(),
      },
    }],
    lockTime: "0",
    outputs: outputSpecs.map((output) => ({
      scriptPublicKey: kaspa.payToScriptHashScript(output.redeemScriptHex).toJSON(),
      value: output.amountSompi.toString(),
    })),
    payload: "",
    subnetworkId: "00".repeat(20),
    version: 1,
  });
  const transaction = kaspa.Transaction.deserializeFromSafeJSON(unsignedSafeJson);
  const signature = kaspa.createInputSignature(
    transaction,
    0,
    new kaspa.PrivateKey(activationPrivateKey),
    kaspa.SighashType.All,
  );
  const innerScript = new kaspa.ScriptBuilder({ flags: { covenantsEnabled: true } });
  innerScript.addOps(signature);
  innerScript.addOp(kaspa.Opcodes.OpTrue);
  const signatureScriptHex = kaspa.payToScriptHashSignatureScript(redeemScriptHex, innerScript.drain());
  const transactionInput = transaction.inputs[0];
  if (!transactionInput) throw new Error("Could not build batch activation input.");
  transactionInput.signatureScript = signatureScriptHex;
  transaction.finalize();

  return {
    computeBudget,
    feeSompi: feeSompi.toString(),
    fundingAddress: fundingAddress.toString(),
    fundingAmountSompi: fundingAmountSompi.toString(),
    fundingOutputIndex,
    fundingTransactionId,
    outputCount: outputSpecs.length,
    signedInBrowser: true,
    transactionId: transaction.id,
    transactionSafeJson: transaction.serializeToSafeJSON(),
    warning:
      "The browser signed the activation transaction. Its covenant can only create the committed child outputs.",
  };
}

export async function preloadClaimableBrowserSigner(): Promise<void> {
  await loadKaspaBrowserModule();
}

async function loadKaspaBrowserModule(): Promise<KaspaBrowserModule> {
  cachedKaspaBrowserModule ??= import(
    /* webpackIgnore: true */ KASPA_WEB_MODULE_URL
  ).then(async (module) => {
    const kaspa = module as KaspaBrowserModule;
    await kaspa.default(KASPA_WEB_WASM_URL);
    return kaspa;
  });

  return cachedKaspaBrowserModule;
}

function normalizeSpendMode(value: string): BrowserClaimableSpendMode {
  if (value === "claim" || value === "refund") return value;
  throw new Error('mode must be "claim" or "refund".');
}

function normalizePrivateKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Spend code must be a 32-byte hex string.");
  }
  return normalized;
}

function normalizeTransactionId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Funding transaction id must be a 32-byte transaction id.");
  }
  return normalized;
}

function normalizeHex(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${label} must be an even-length hex string.`);
  }
  return normalized;
}

function normalizeOutputIndex(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Funding output index must be a non-negative integer.");
  }
  return value;
}

function normalizeComputeBudget(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("Compute budget must be an integer between 1 and 100.");
  }
  return value;
}

function parsePositiveBigInt(value: string, label: string): bigint {
  const parsed = parseNonNegativeBigInt(value, label);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function parseNonNegativeBigInt(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${label} must be a whole number.`);
  }
  const parsed = BigInt(trimmed);
  if (parsed < 0n) {
    throw new Error(`${label} must not be negative.`);
  }
  return parsed;
}
