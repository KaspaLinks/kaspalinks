import { createRequire } from "node:module";

import { validateKaspaAddress } from "./address";

type KaspaWasmModule = typeof import("kaspa-wasm");

let cachedKaspaWasm: KaspaWasmModule | null = null;

export type ToccataSdkCapabilityName =
  | "Address"
  | "CovenantBinding"
  | "Opcodes"
  | "PSKT"
  | "PaymentOutput"
  | "ScriptBuilder"
  | "SigHashType"
  | "Transaction"
  | "TransactionInput"
  | "TransactionOutput"
  | "addressFromScriptPublicKey"
  | "covenantId"
  | "payToScriptHashScript"
  | "payToScriptHashSignatureScript";

export type ToccataSdkCapabilities = {
  missing: ToccataSdkCapabilityName[];
  ready: boolean;
  version: string;
};

export const TOCCATA_REQUIRED_CAPABILITIES = [
  "Address",
  "CovenantBinding",
  "Opcodes",
  "PSKT",
  "PaymentOutput",
  "ScriptBuilder",
  "SigHashType",
  "Transaction",
  "TransactionInput",
  "TransactionOutput",
  "addressFromScriptPublicKey",
  "covenantId",
  "payToScriptHashScript",
  "payToScriptHashSignatureScript",
] as const satisfies readonly ToccataSdkCapabilityName[];

type PartialKaspaWasmModule = Partial<Record<ToccataSdkCapabilityName | "version", unknown>>;

const TOCCATA_SMOKE_AMOUNT_SOMPI = 1_000_000n;
const TOCCATA_SAFE_JSON_SMOKE_AMOUNT_SOMPI = 20_000_000n;
const TOCCATA_CLAIMABLE_LAB_COMPUTE_BUDGET = 11;
const TOCCATA_CLAIMABLE_LAB_MIN_OUTPUT_SOMPI = 20_000_000n;
const TOCCATA_SMOKE_DUMMY_OUTPOINT = {
  index: 0,
  transactionId: "00".repeat(32),
} as const;

export type ToccataSmokeStepStatus = "blocked" | "passed";

export type ToccataSmokeStep = {
  detail: string;
  name: string;
  status: ToccataSmokeStepStatus;
};

export type ToccataPsktSmokePrototype = {
  amountSompi: string;
  covenant: {
    authorizedOutputIndex: number;
    binding: {
      authorizingInput: number;
      covenantId: string;
    };
    covenantId: string;
    dummyGenesisOutpoint: {
      index: number;
      transactionId: string;
    };
    output: {
      hasCovenant: boolean;
      scriptPublicKeyHex: string;
      valueSompi: string;
    };
  };
  network: "mainnet";
  pskt: {
    hasInputs: boolean;
    hasSignatures: boolean;
    outputCount: number;
    role: string;
    serialized: string;
    serializedLength: number;
    serializedPreview: string;
    txVersion: number;
  };
  safeToFund: false;
  script: {
    opcode: "OpFalse";
    p2shAddress: string;
    redeemScriptHex: string;
    scriptPublicKey: {
      script: string;
      version: number;
    };
  };
  sdk: ToccataSdkCapabilities;
  steps: ToccataSmokeStep[];
  warnings: string[];
};

export type ToccataSafeJsonSmokePrototype = {
  amountSompi: string;
  // Answers the wallet-transport question for covenants: does
  // serializeToSafeJSON carry a covenant binding, and does it survive the
  // deserialize round trip? `supported` is only true when both hold.
  covenant: {
    covenantId: null | string;
    roundTripPreserved: boolean;
    safeJsonIncludesBinding: boolean;
    supported: boolean;
  };
  format: "safe-json-transaction";
  network: "mainnet";
  safeToFund: false;
  script: {
    opcode: "OpFalse";
    p2shAddress: string;
    redeemScriptHex: string;
    scriptPublicKey: {
      script: string;
      version: number;
    };
  };
  sdk: ToccataSdkCapabilities;
  steps: ToccataSmokeStep[];
  transaction: {
    hasInputs: boolean;
    hasSignatures: boolean;
    id: null | string;
    inputCount: number;
    outputCount: number;
    outputValueSompi: string;
    safeJson: string;
    safeJsonLength: number;
    safeJsonPreview: string;
    scriptPublicKeyHex: string;
    txVersion: number;
  };
  walletSignable: false;
  warnings: string[];
};

export type ToccataClaimableLabScriptInput = {
  linkPublicKey: string;
  refundLockTime: bigint | string;
  refundPublicKey: string;
};

export type ToccataClaimableLabScript = {
  fundingAddress: string;
  linkPublicKey: string;
  network: "mainnet";
  redeemScriptHex: string;
  refundLockTime: string;
  refundPublicKey: string;
  scriptPublicKey: {
    script: string;
    version: number;
  };
  warning: string;
};

export type ToccataBatchAllocatorLabOutput = {
  amountSompi: bigint | string;
  // `OpTxOutputSpk` exposes the serialized ScriptPublicKey: a two-byte
  // big-endian version followed by the script bytes.
  scriptPublicKeyHex: string;
};

export type ToccataBatchAllocatorLabScriptInput = {
  activationPublicKey: string;
  outputs: ToccataBatchAllocatorLabOutput[];
  refundLockTime: bigint | string;
  refundPublicKey: string;
};

export type ToccataBatchAllocatorLabScript = {
  activationPublicKey: string;
  fundingAddress: string;
  network: "mainnet";
  outputCount: number;
  outputs: Array<{ amountSompi: string; scriptPublicKeyHex: string }>;
  redeemScriptHex: string;
  refundLockTime: string;
  refundPublicKey: string;
  scriptPublicKey: {
    script: string;
    version: number;
  };
  warning: string;
};

export type ToccataClaimableLabSpendMode = "claim" | "refund";

export type ToccataClaimableLabSpendInput = {
  computeBudget?: number;
  destinationAddress: string;
  expectedFundingAddress?: null | string;
  feeSompi: bigint | string;
  fundingAmountSompi: bigint | string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  lockTime?: bigint | string;
  mode: ToccataClaimableLabSpendMode;
  privateKey: string;
  redeemScriptHex: string;
};

export type ToccataClaimableLabSpend = {
  computeBudget: number;
  destinationAddress: string;
  feeSompi: string;
  fundingAddress: string;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  lockTime: string;
  mode: ToccataClaimableLabSpendMode;
  network: "mainnet";
  outputAmountSompi: string;
  redeemScriptHex: string;
  signatureScriptHex: string;
  transactionId: string;
  transactionSafeJson: string;
  warning: string;
};

export type ToccataSafeJsonTransactionSubmitInput = {
  allowOrphan?: boolean;
  networkId?: "mainnet";
  timeoutMs?: number;
  transactionSafeJson: string;
};

export type ToccataSafeJsonTransactionSubmitResult = {
  localTransactionId: string;
  network: "mainnet";
  submittedTransactionId: string;
};

type ScriptPublicKeyJson = {
  script: string;
  version: number;
};

type TransactionOutputJson = {
  covenant?: {
    authorizingInput: number;
    covenantId: string;
  };
  scriptPublicKey: ScriptPublicKeyJson;
  value: bigint;
};

type SerializedPskt = {
  payload?: {
    global?: {
      inputCount?: number;
      outputCount?: number;
      txVersion?: number;
    };
  };
  state?: string;
};

type SafeJsonTransaction = {
  id?: string;
  inputs?: unknown[];
  outputs?: Array<{
    covenant?: {
      authorizingInput?: number;
      covenantId?: string;
    };
    scriptPublicKey?: string | ScriptPublicKeyJson;
    value?: string;
  }>;
  version?: number;
};

type CovenantSafeJsonSmokeOutcome = {
  result: ToccataSafeJsonSmokePrototype["covenant"];
  step: ToccataSmokeStep;
};

type ToccataSmokeScript = {
  p2shAddress: string;
  redeemScriptHex: string;
  scriptPublicKey: InstanceType<KaspaWasmModule["ScriptPublicKey"]>;
  scriptPublicKeyJson: ScriptPublicKeyJson;
};

export function inspectToccataSdkCapabilities(
  wasmModule: PartialKaspaWasmModule = loadKaspaWasm(),
): ToccataSdkCapabilities {
  const missing = TOCCATA_REQUIRED_CAPABILITIES.filter(
    (capability) => wasmModule[capability] === undefined,
  );

  return {
    missing,
    ready: missing.length === 0,
    version: readKaspaWasmVersion(wasmModule),
  };
}

export function assertToccataSdkReady(
  wasmModule: PartialKaspaWasmModule = loadKaspaWasm(),
): ToccataSdkCapabilities {
  const capabilities = inspectToccataSdkCapabilities(wasmModule);

  if (!capabilities.ready) {
    throw new Error(
      `Kaspa Toccata SDK is missing: ${capabilities.missing.join(", ")}. ` +
        "Use the vendored rusty-kaspa v2.0.1 WASM SDK before enabling covenant features.",
    );
  }

  return capabilities;
}

export function createToccataPsktSmokePrototype(
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataPsktSmokePrototype {
  const sdk = assertToccataSdkReady(wasmModule);
  const steps: ToccataSmokeStep[] = [];
  const script = buildToccataSmokeScript(wasmModule);

  steps.push({
    detail: "Built a deterministic OP_FALSE redeem script and derived its mainnet P2SH address.",
    name: "Script hash derivation",
    status: "passed",
  });

  const authorizedOutput = new wasmModule.TransactionOutput(
    TOCCATA_SMOKE_AMOUNT_SOMPI,
    script.scriptPublicKey,
  );
  const covenantId = wasmModule.covenantId(TOCCATA_SMOKE_DUMMY_OUTPOINT, [
    { index: 0, output: authorizedOutput },
  ]);
  const covenantIdHex = covenantId.toString();
  const covenantBinding = new wasmModule.CovenantBinding(0, covenantId);
  const covenantOutput = new wasmModule.TransactionOutput(
    TOCCATA_SMOKE_AMOUNT_SOMPI,
    script.scriptPublicKey,
    covenantBinding,
  );
  const covenantOutputJson = covenantOutput.toJSON() as TransactionOutputJson;

  steps.push({
    detail:
      "Derived a covenant id from a deterministic dummy genesis outpoint and bound it to an output.",
    name: "Covenant binding",
    status: "passed",
  });

  const pskt = new wasmModule.PSKT(undefined);
  pskt.toConstructor();
  pskt.output(authorizedOutput);
  pskt.noMoreInputs();
  pskt.noMoreOutputs();
  const serializedPskt = pskt.serialize();
  const parsedPskt = JSON.parse(serializedPskt) as SerializedPskt;

  steps.push({
    detail:
      "Created an unsigned constructor-role PSKT with one output and no inputs or signatures.",
    name: "Unsigned PSKT construction",
    status: "passed",
  });

  steps.push(runCovenantPsktOutputSmoke(wasmModule, covenantOutput));

  return {
    amountSompi: TOCCATA_SMOKE_AMOUNT_SOMPI.toString(),
    covenant: {
      authorizedOutputIndex: 0,
      binding: {
        authorizingInput: covenantOutputJson.covenant?.authorizingInput ?? 0,
        covenantId: covenantOutputJson.covenant?.covenantId ?? covenantIdHex,
      },
      covenantId: covenantIdHex,
      dummyGenesisOutpoint: TOCCATA_SMOKE_DUMMY_OUTPOINT,
      output: {
        hasCovenant: covenantOutputJson.covenant !== undefined,
        scriptPublicKeyHex: serializeScriptPublicKey(covenantOutputJson.scriptPublicKey),
        valueSompi: covenantOutputJson.value.toString(),
      },
    },
    network: "mainnet",
    pskt: {
      hasInputs: (parsedPskt.payload?.global?.inputCount ?? 0) > 0,
      hasSignatures: false,
      outputCount: parsedPskt.payload?.global?.outputCount ?? 0,
      role: parsedPskt.state ?? pskt.role,
      serialized: serializedPskt,
      serializedLength: serializedPskt.length,
      serializedPreview: truncate(serializedPskt, 240),
      txVersion: parsedPskt.payload?.global?.txVersion ?? 0,
    },
    safeToFund: false,
    script: {
      opcode: "OpFalse",
      p2shAddress: script.p2shAddress,
      redeemScriptHex: script.redeemScriptHex,
      scriptPublicKey: script.scriptPublicKeyJson,
    },
    sdk,
    steps,
    warnings: [
      "Smoke output uses a deterministic OP_FALSE script and dummy genesis outpoint. Do not fund it.",
      "This prototype does not sign, broadcast, store private keys, or create claimable links.",
      "Real claimable links still need wallet Transaction SafeJSON/covenant signing support and a reviewed script design.",
    ],
  };
}

export function createToccataSafeJsonSmokePrototype(
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataSafeJsonSmokePrototype {
  const sdk = assertToccataSdkReady(wasmModule);
  const script = buildToccataSmokeScript(wasmModule);
  const steps: ToccataSmokeStep[] = [
    {
      detail: "Built a deterministic OP_FALSE redeem script and derived its mainnet P2SH address.",
      name: "Script hash derivation",
      status: "passed",
    },
  ];

  const output = new wasmModule.TransactionOutput(
    TOCCATA_SAFE_JSON_SMOKE_AMOUNT_SOMPI,
    script.scriptPublicKey,
  );
  const transaction = new wasmModule.Transaction({
    gas: 0n,
    inputs: [],
    lockTime: 0n,
    outputs: [output],
    payload: "",
    subnetworkId: "00".repeat(20),
    version: 0,
  });
  const safeJson = transaction.serializeToSafeJSON();
  const parsedTransaction = JSON.parse(safeJson) as SafeJsonTransaction;
  const parsedOutput = parsedTransaction.outputs?.[0];

  steps.push({
    detail:
      "Serialized a transaction with bigint values encoded as strings for wallet/provider transport.",
    name: "SafeJSON serialization",
    status: "passed",
  });

  const roundTripTransaction = wasmModule.Transaction.deserializeFromSafeJSON(safeJson);
  const roundTripJson = roundTripTransaction.toJSON() as {
    inputs?: unknown[];
    outputs?: unknown[];
  };

  steps.push({
    detail:
      "Deserialized the SafeJSON payload back into the SDK Transaction type without losing outputs.",
    name: "SafeJSON round trip",
    status: "passed",
  });

  const covenantSmoke = runCovenantSafeJsonSmoke(wasmModule, script);
  steps.push(covenantSmoke.step);

  return {
    amountSompi: TOCCATA_SAFE_JSON_SMOKE_AMOUNT_SOMPI.toString(),
    covenant: covenantSmoke.result,
    format: "safe-json-transaction",
    network: "mainnet",
    safeToFund: false,
    script: {
      opcode: "OpFalse",
      p2shAddress: script.p2shAddress,
      redeemScriptHex: script.redeemScriptHex,
      scriptPublicKey: script.scriptPublicKeyJson,
    },
    sdk,
    steps,
    transaction: {
      hasInputs: (parsedTransaction.inputs?.length ?? 0) > 0,
      hasSignatures: false,
      id: typeof parsedTransaction.id === "string" ? parsedTransaction.id : null,
      inputCount: roundTripJson.inputs?.length ?? parsedTransaction.inputs?.length ?? 0,
      outputCount: roundTripJson.outputs?.length ?? parsedTransaction.outputs?.length ?? 0,
      outputValueSompi: parsedOutput?.value ?? TOCCATA_SAFE_JSON_SMOKE_AMOUNT_SOMPI.toString(),
      safeJson,
      safeJsonLength: safeJson.length,
      safeJsonPreview: truncate(safeJson, 260),
      scriptPublicKeyHex: normalizeSafeJsonScriptPublicKey(parsedOutput?.scriptPublicKey),
      txVersion: parsedTransaction.version ?? 0,
    },
    walletSignable: false,
    warnings: [
      "Decode-only SafeJSON transaction has no wallet-owned UTXO input. Do not fund or broadcast it.",
      "KasWare's signPskt surface expects Transaction SafeJSON, not the internal PSKT wrapper JSON.",
      "The next fundable gate needs a real UTXO lookup, fee/mass calculation, and a reviewed self-spend builder.",
    ],
  };
}

export function buildToccataClaimableLabScript(
  input: ToccataClaimableLabScriptInput,
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataClaimableLabScript {
  assertToccataSdkReady(wasmModule);

  const linkPublicKey = normalizeXOnlyPublicKey(input.linkPublicKey, "linkPublicKey");
  const refundPublicKey = normalizeXOnlyPublicKey(input.refundPublicKey, "refundPublicKey");
  const refundLockTime = normalizeRefundLockTime(input.refundLockTime);

  // Lab-only direct script equivalent of:
  // claim(sig): checkSig(sig, linkPk)
  // refund(sig): tx.lockTime >= refundAfter && checkSig(sig, refundPk)
  //
  // The signature script is expected to leave `[sig, branch]` on the stack,
  // where branch=true selects claim and branch=false selects refund.
  const builder = new wasmModule.ScriptBuilder({ flags: { covenantsEnabled: true } });
  builder.addOp(wasmModule.Opcodes.OpIf);
  builder.addData(linkPublicKey);
  builder.addOp(wasmModule.Opcodes.OpCheckSig);
  builder.addOp(wasmModule.Opcodes.OpElse);
  builder.addOp(wasmModule.Opcodes.OpTxLockTime);
  builder.addLockTime(refundLockTime);
  builder.addOp(wasmModule.Opcodes.OpGreaterThanOrEqual);
  builder.addOp(wasmModule.Opcodes.OpVerify);
  builder.addData(refundPublicKey);
  builder.addOp(wasmModule.Opcodes.OpCheckSig);
  builder.addOp(wasmModule.Opcodes.OpEndIf);

  const redeemScriptHex = builder.toString();
  const scriptPublicKey = wasmModule.payToScriptHashScript(redeemScriptHex);
  const scriptPublicKeyJson = scriptPublicKey.toJSON() as ScriptPublicKeyJson;
  const fundingAddress = wasmModule.addressFromScriptPublicKey(scriptPublicKey, "mainnet");

  if (!fundingAddress) {
    throw new Error("Could not derive claimable lab P2SH address.");
  }

  return {
    fundingAddress: fundingAddress.toString(),
    linkPublicKey,
    network: "mainnet",
    redeemScriptHex,
    refundLockTime: refundLockTime.toString(),
    refundPublicKey,
    scriptPublicKey: scriptPublicKeyJson,
    warning:
      "Experimental lab script. Use tiny mainnet amounts only. This is not a reviewed production claimable-link contract.",
  };
}

export function buildToccataBatchAllocatorLabScript(
  input: ToccataBatchAllocatorLabScriptInput,
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataBatchAllocatorLabScript {
  assertToccataSdkReady(wasmModule);

  const activationPublicKey = normalizeXOnlyPublicKey(input.activationPublicKey, "activationPublicKey");
  const refundPublicKey = normalizeXOnlyPublicKey(input.refundPublicKey, "refundPublicKey");
  const refundLockTime = normalizeRefundLockTime(input.refundLockTime);
  const outputs = normalizeBatchAllocatorOutputs(input.outputs);

  // The activation branch cannot choose recipients or amounts. It must spend
  // exactly one batch UTXO into the exact ordered list committed below.
  // This is what keeps the convenience funding address non-custodial.
  const builder = new wasmModule.ScriptBuilder({ flags: { covenantsEnabled: true } });
  builder.addOp(wasmModule.Opcodes.OpIf);
  builder.addData(activationPublicKey);
  builder.addOp(wasmModule.Opcodes.OpCheckSigVerify);
  builder.addOp(wasmModule.Opcodes.OpTxInputCount);
  builder.addI64(1n);
  builder.addOp(wasmModule.Opcodes.OpNumEqualVerify);
  builder.addOp(wasmModule.Opcodes.OpTxOutputCount);
  builder.addI64(BigInt(outputs.length));
  builder.addOp(wasmModule.Opcodes.OpNumEqualVerify);

  for (const [index, output] of outputs.entries()) {
    builder.addI64(BigInt(index));
    builder.addOp(wasmModule.Opcodes.OpTxOutputAmount);
    builder.addI64(output.amountSompi);
    builder.addOp(wasmModule.Opcodes.OpNumEqualVerify);
    builder.addI64(BigInt(index));
    builder.addOp(wasmModule.Opcodes.OpTxOutputSpk);
    builder.addData(output.scriptPublicKeyHex);
    builder.addOp(wasmModule.Opcodes.OpEqualVerify);
  }

  builder.addOp(wasmModule.Opcodes.OpTrue);
  builder.addOp(wasmModule.Opcodes.OpElse);
  builder.addOp(wasmModule.Opcodes.OpTxLockTime);
  builder.addLockTime(refundLockTime);
  builder.addOp(wasmModule.Opcodes.OpGreaterThanOrEqual);
  builder.addOp(wasmModule.Opcodes.OpVerify);
  builder.addData(refundPublicKey);
  builder.addOp(wasmModule.Opcodes.OpCheckSig);
  builder.addOp(wasmModule.Opcodes.OpEndIf);

  const redeemScriptHex = builder.toString();
  const scriptPublicKey = wasmModule.payToScriptHashScript(redeemScriptHex);
  const scriptPublicKeyJson = scriptPublicKey.toJSON() as ScriptPublicKeyJson;
  const fundingAddress = wasmModule.addressFromScriptPublicKey(scriptPublicKey, "mainnet");
  if (!fundingAddress) {
    throw new Error("Could not derive batch allocator P2SH address.");
  }

  return {
    activationPublicKey,
    fundingAddress: fundingAddress.toString(),
    network: "mainnet",
    outputCount: outputs.length,
    outputs: outputs.map((output) => ({
      amountSompi: output.amountSompi.toString(),
      scriptPublicKeyHex: output.scriptPublicKeyHex,
    })),
    redeemScriptHex,
    refundLockTime: refundLockTime.toString(),
    refundPublicKey,
    scriptPublicKey: scriptPublicKeyJson,
    warning:
      "Experimental lab contract. The activation signature cannot change the committed child outputs. Use tiny mainnet amounts only.",
  };
}

export function buildToccataClaimableLabSpend(
  input: ToccataClaimableLabSpendInput,
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): ToccataClaimableLabSpend {
  assertToccataSdkReady(wasmModule);

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
  const lockTime = parseNonNegativeBigInt(input.lockTime ?? 0n, "lockTime");
  const computeBudget = normalizeComputeBudget(
    input.computeBudget ?? TOCCATA_CLAIMABLE_LAB_COMPUTE_BUDGET,
  );
  const destinationAddress = validateMainnetSpendAddress(input.destinationAddress);

  if (feeSompi >= fundingAmountSompi) {
    throw new Error("Lab spend fee must be lower than the funding amount.");
  }

  const outputAmountSompi = fundingAmountSompi - feeSompi;
  if (outputAmountSompi < TOCCATA_CLAIMABLE_LAB_MIN_OUTPUT_SOMPI) {
    throw new Error("Lab spend output must stay at or above the 0.2 KAS floor.");
  }

  const scriptPublicKey = wasmModule.payToScriptHashScript(redeemScriptHex);
  const fundingAddress = wasmModule.addressFromScriptPublicKey(scriptPublicKey, "mainnet");
  if (!fundingAddress) {
    throw new Error("Could not derive claimable lab funding address from redeem script.");
  }

  const normalizedFundingAddress = fundingAddress.toString();
  if (
    input.expectedFundingAddress !== undefined &&
    input.expectedFundingAddress !== null &&
    input.expectedFundingAddress !== normalizedFundingAddress
  ) {
    throw new Error("Redeem script does not match the expected funding address.");
  }

  const destinationScriptPublicKey = wasmModule.payToAddressScript(destinationAddress);
  const unsignedSafeJson = stringifySafeTransaction({
    id: "0".repeat(64),
    version: 1,
    inputs: [
      {
        transactionId: fundingTransactionId,
        index: fundingOutputIndex,
        sequence: "0",
        sigOpCount: 0,
        computeBudget,
        signatureScript: "",
        utxo: {
          amount: fundingAmountSompi.toString(),
          scriptPublicKey: scriptPublicKey.toJSON(),
          blockDaaScore: "0",
          isCoinbase: false,
        },
      },
    ],
    outputs: [
      {
        value: outputAmountSompi.toString(),
        scriptPublicKey: destinationScriptPublicKey.toJSON(),
      },
    ],
    lockTime: lockTime.toString(),
    subnetworkId: "00".repeat(20),
    gas: "0",
    payload: "",
  });
  const transaction = wasmModule.Transaction.deserializeFromSafeJSON(unsignedSafeJson);
  const signature = wasmModule.createInputSignature(
    transaction,
    0,
    new wasmModule.PrivateKey(privateKey),
    wasmModule.SighashType.All,
  );
  const innerScript = new wasmModule.ScriptBuilder({ flags: { covenantsEnabled: true } });
  innerScript.addOps(signature);
  innerScript.addOp(mode === "claim" ? wasmModule.Opcodes.OpTrue : wasmModule.Opcodes.OpFalse);
  const signatureScriptHex = wasmModule.payToScriptHashSignatureScript(
    redeemScriptHex,
    innerScript.drain(),
  );
  const transactionInput = transaction.inputs[0];
  if (!transactionInput) {
    throw new Error("Could not build claimable lab spend input.");
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
    transactionId: transaction.id,
    transactionSafeJson: transaction.serializeToSafeJSON(),
    warning:
      "Experimental lab spend. This helper signs on the server-side lab bridge and must be replaced by browser-side signing before production.",
  };
}

export async function submitToccataSafeJsonTransaction(
  input: ToccataSafeJsonTransactionSubmitInput,
  wasmModule: KaspaWasmModule = loadKaspaWasm(),
): Promise<ToccataSafeJsonTransactionSubmitResult> {
  assertToccataSdkReady(wasmModule);

  const networkId = input.networkId ?? "mainnet";
  const timeoutMs = input.timeoutMs ?? 20_000;
  const transaction = wasmModule.Transaction.deserializeFromSafeJSON(input.transactionSafeJson);
  const localTransactionId = transaction.id;
  const rpc = new wasmModule.RpcClient({
    networkId,
    resolver: new wasmModule.Resolver(),
  });

  try {
    await withTimeout(rpc.connect(), timeoutMs, "Kaspa RPC connect");
    const submitted = await withTimeout(
      rpc.submitTransaction({
        allowOrphan: input.allowOrphan ?? false,
        transaction,
      }),
      timeoutMs,
      "Kaspa RPC submit",
    );

    return {
      localTransactionId,
      network: networkId,
      submittedTransactionId: submitted.transactionId ?? localTransactionId,
    };
  } finally {
    await rpc.disconnect().catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise.then(resolve, reject).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    });
  });
}

function readKaspaWasmVersion(wasmModule: PartialKaspaWasmModule): string {
  const version = wasmModule.version;

  if (typeof version === "function") {
    const value = version();
    return typeof value === "string" ? value : "unknown";
  }

  return "unknown";
}

function loadKaspaWasm(): KaspaWasmModule {
  cachedKaspaWasm ??= requireKaspaWasmAtRuntime();
  return cachedKaspaWasm;
}

function requireKaspaWasmAtRuntime(): KaspaWasmModule {
  const runtimeRequire = createRequire(import.meta.url);
  return runtimeRequire("kaspa-wasm") as KaspaWasmModule;
}

function normalizeXOnlyPublicKey(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 32-byte x-only public key hex string.`);
  }
  return normalized;
}

function normalizeBatchAllocatorOutputs(
  value: ToccataBatchAllocatorLabOutput[],
): Array<{ amountSompi: bigint; scriptPublicKeyHex: string }> {
  if (!Array.isArray(value) || value.length < 2 || value.length > 10) {
    throw new Error("Batch allocator requires between 2 and 10 committed outputs.");
  }

  return value.map((output, index) => ({
    amountSompi: parsePositiveBigInt(output.amountSompi, `outputs[${index}].amountSompi`),
    scriptPublicKeyHex: normalizeSerializedScriptPublicKey(
      output.scriptPublicKeyHex,
      `outputs[${index}].scriptPublicKeyHex`,
    ),
  }));
}

function normalizeSerializedScriptPublicKey(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  // A serialized ScriptPublicKey contains at least its two-byte version and a
  // non-empty script. The P2SH children passed by the lab are version 0.
  if (!/^[0-9a-f]+$/.test(normalized) || normalized.length < 6 || normalized.length % 2 !== 0) {
    throw new Error(`${label} must be serialized ScriptPublicKey hex.`);
  }
  return normalized;
}

function normalizePrivateKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("privateKey must be a 32-byte hex string.");
  }
  return normalized;
}

function normalizeSpendMode(value: string): ToccataClaimableLabSpendMode {
  if (value === "claim" || value === "refund") {
    return value;
  }
  throw new Error('mode must be "claim" or "refund".');
}

function normalizeTransactionId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("fundingTransactionId must be a 32-byte transaction id.");
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
    throw new Error("fundingOutputIndex must be a non-negative integer.");
  }
  return value;
}

function normalizeComputeBudget(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("computeBudget must be an integer between 1 and 100.");
  }
  return value;
}

function parsePositiveBigInt(value: bigint | string, label: string): bigint {
  const parsed = parseNonNegativeBigInt(value, label);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function parseNonNegativeBigInt(value: bigint | string, label: string): bigint {
  const parsed = typeof value === "bigint" ? value : parseBigIntString(value, label);
  if (parsed < 0n) {
    throw new Error(`${label} must not be negative.`);
  }
  return parsed;
}

function validateMainnetSpendAddress(address: string): string {
  const validation = validateKaspaAddress(address);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }
  if (validation.network !== "mainnet") {
    throw new Error("Destination address must be a mainnet kaspa: address.");
  }
  return validation.address;
}

function stringifySafeTransaction(value: unknown): string {
  return JSON.stringify(value);
}

function normalizeRefundLockTime(value: bigint | string): bigint {
  const normalized = typeof value === "bigint" ? value : parseBigIntString(value, "refundLockTime");
  if (normalized < 0n) {
    throw new Error("refundLockTime must not be negative.");
  }
  return normalized;
}

function parseBigIntString(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`${label} must be a whole number.`);
  }
  return BigInt(trimmed);
}

function buildToccataSmokeScript(wasmModule: KaspaWasmModule): ToccataSmokeScript {
  const scriptBuilder = new wasmModule.ScriptBuilder();
  scriptBuilder.addOp(wasmModule.Opcodes.OpFalse);
  const redeemScriptHex = scriptBuilder.drain();
  const scriptPublicKey = wasmModule.payToScriptHashScript(redeemScriptHex);
  const scriptPublicKeyJson = scriptPublicKey.toJSON() as ScriptPublicKeyJson;
  const p2shAddress = wasmModule.addressFromScriptPublicKey(scriptPublicKey, "mainnet");

  if (!p2shAddress) {
    throw new Error("Could not derive a mainnet P2SH address from the smoke script.");
  }

  return {
    p2shAddress: p2shAddress.toString(),
    redeemScriptHex,
    scriptPublicKey,
    scriptPublicKeyJson,
  };
}

function runCovenantPsktOutputSmoke(
  wasmModule: KaspaWasmModule,
  covenantOutput: InstanceType<KaspaWasmModule["TransactionOutput"]>,
): ToccataSmokeStep {
  try {
    const covenantPskt = new wasmModule.PSKT(undefined);
    covenantPskt.toConstructor();
    covenantPskt.output(covenantOutput);
    covenantPskt.noMoreInputs();
    covenantPskt.noMoreOutputs();
    covenantPskt.serialize();

    return {
      detail: "The SDK accepted a covenant-bearing output inside a constructor-role PSKT.",
      name: "Covenant output in PSKT",
      status: "passed",
    };
  } catch (error) {
    return {
      detail: `SDK blocked covenant output insertion: ${readErrorMessage(error)}.`,
      name: "Covenant output in PSKT",
      status: "blocked",
    };
  }
}

/**
 * The wallet-transport question for covenants: KasWare's signPskt consumes
 * Transaction SafeJSON, so covenant-era flows only work end-to-end if a
 * covenant binding survives serializeToSafeJSON and the deserialize round
 * trip. Runs entirely on deterministic dummy data — nothing here is fundable
 * or broadcastable. Reports "blocked" (never throws) so the rest of the smoke
 * stays useful when the SDK rejects or silently drops the binding.
 */
function runCovenantSafeJsonSmoke(
  wasmModule: KaspaWasmModule,
  script: ToccataSmokeScript,
): CovenantSafeJsonSmokeOutcome {
  const failure = (
    detail: string,
    partial: Partial<ToccataSafeJsonSmokePrototype["covenant"]> = {},
  ): CovenantSafeJsonSmokeOutcome => ({
    result: {
      covenantId: null,
      roundTripPreserved: false,
      safeJsonIncludesBinding: false,
      supported: false,
      ...partial,
    },
    step: {
      detail,
      name: "Covenant output in SafeJSON",
      status: "blocked",
    },
  });

  try {
    const baseOutput = new wasmModule.TransactionOutput(
      TOCCATA_SAFE_JSON_SMOKE_AMOUNT_SOMPI,
      script.scriptPublicKey,
    );
    const covenantId = wasmModule.covenantId(TOCCATA_SMOKE_DUMMY_OUTPOINT, [
      { index: 0, output: baseOutput },
    ]);
    const covenantIdHex = covenantId.toString();
    const covenantBinding = new wasmModule.CovenantBinding(0, covenantId);
    const covenantOutput = new wasmModule.TransactionOutput(
      TOCCATA_SAFE_JSON_SMOKE_AMOUNT_SOMPI,
      script.scriptPublicKey,
      covenantBinding,
    );
    const transaction = new wasmModule.Transaction({
      gas: 0n,
      inputs: [],
      lockTime: 0n,
      outputs: [covenantOutput],
      payload: "",
      subnetworkId: "00".repeat(20),
      version: 0,
    });

    const safeJson = transaction.serializeToSafeJSON();
    const parsed = JSON.parse(safeJson) as SafeJsonTransaction;
    const serializedCovenantId = parsed.outputs?.[0]?.covenant?.covenantId;
    const safeJsonIncludesBinding = serializedCovenantId === covenantIdHex;

    if (!safeJsonIncludesBinding) {
      return failure(
        "serializeToSafeJSON drops the covenant binding — SafeJSON wallet transport cannot carry covenants yet.",
        { covenantId: covenantIdHex },
      );
    }

    const roundTrip = wasmModule.Transaction.deserializeFromSafeJSON(safeJson);
    const reParsed = JSON.parse(roundTrip.serializeToSafeJSON()) as SafeJsonTransaction;
    const roundTripPreserved = reParsed.outputs?.[0]?.covenant?.covenantId === covenantIdHex;

    if (!roundTripPreserved) {
      return failure(
        "The covenant binding is lost when the SafeJSON payload is deserialized and re-serialized.",
        { covenantId: covenantIdHex, safeJsonIncludesBinding: true },
      );
    }

    return {
      result: {
        covenantId: covenantIdHex,
        roundTripPreserved: true,
        safeJsonIncludesBinding: true,
        supported: true,
      },
      step: {
        detail:
          "SafeJSON carries the covenant binding and preserves it across a full deserialize/serialize round trip.",
        name: "Covenant output in SafeJSON",
        status: "passed",
      },
    };
  } catch (error) {
    return failure(`SDK rejected the covenant SafeJSON round trip: ${readErrorMessage(error)}.`);
  }
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Unknown SDK error";
}

function serializeScriptPublicKey(scriptPublicKey: ScriptPublicKeyJson): string {
  return `${scriptPublicKey.version.toString(16).padStart(4, "0")}${scriptPublicKey.script}`;
}

function normalizeSafeJsonScriptPublicKey(
  scriptPublicKey: ScriptPublicKeyJson | string | undefined,
): string {
  if (typeof scriptPublicKey === "string") {
    return scriptPublicKey;
  }
  if (scriptPublicKey) {
    return serializeScriptPublicKey(scriptPublicKey);
  }
  return "";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}
