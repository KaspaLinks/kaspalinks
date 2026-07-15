import {
  assertToccataSdkReady,
  buildToccataBatchAllocatorLabScript,
  buildToccataClaimableLabScript,
  buildKaspaPaymentUri,
  createToccataPsktSmokePrototype,
  createToccataSafeJsonSmokePrototype,
  formatSompiToKaspa,
  parseKaspaAmountToSompi,
  TOCCATA_REQUIRED_CAPABILITIES,
  validateKaspaAddress,
  type ToccataPsktSmokePrototype,
  type ToccataSafeJsonSmokePrototype,
  type ToccataSdkCapabilities,
} from "@kaspa-actions/kaspa";
import { z } from "zod";

import {
  TOCCATA_LAB_DEFAULT_LABEL,
  TOCCATA_LAB_MIN_KAS,
  TOCCATA_LAB_MIN_SOMPI,
} from "./toccata-lab-constants";
import { planToccataCanarySpend, TOCCATA_CANARY_MIN_OUTPUT_SOMPI } from "./toccata-lab-fee";
import { assertReliableMainnetOutputAmount } from "./mainnet-amount-policy";

export {
  TOCCATA_LAB_DEFAULT_AMOUNT_KAS,
  TOCCATA_LAB_DEFAULT_LABEL,
  TOCCATA_LAB_MIN_KAS,
  TOCCATA_LAB_MIN_SOMPI,
} from "./toccata-lab-constants";

type ToccataLabIntentInput = {
  amountKas: string;
  label?: null | string;
  message?: null | string;
  recipientAddress: string;
};

export type ToccataLabIntent = {
  amountKas: string;
  amountSompi: string;
  label: string;
  message: null | string;
  network: "mainnet";
  recipientAddress: string;
  sdk: ToccataSdkCapabilities;
  uri: string;
  walletLaunchUri: string;
};

export type ToccataLabPsktSmokePrototype = ToccataPsktSmokePrototype;
export type ToccataLabSafeJsonSmokePrototype = ToccataSafeJsonSmokePrototype;

const toccataClaimableScriptKeysSchema = z.object({
  linkPublicKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "Claim public key must be 32-byte hex."),
  refundPublicKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "Refund public key must be 32-byte hex."),
});

const toccataBatchAllocatorOutputSchema = z.object({
  amountSompi: z
    .string()
    .regex(/^[0-9]+$/, "Output amount must be whole sompi.")
    .refine((value) => BigInt(value) > 0n, "Output amount must be greater than zero."),
  scriptPublicKeyHex: z
    .string()
    .regex(/^[0-9a-fA-F]{6,}$/, "Output script public key must be serialized hex.")
    .refine(
      (value) => value.length % 2 === 0,
      "Output script public key must have even hex length.",
    ),
});

export const toccataClaimableScriptInputSchema = toccataClaimableScriptKeysSchema.extend({
  refundLockTime: z.string().regex(/^[0-9]+$/, "Refund lock time must be a whole number."),
});

const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export const registeredClaimableMetadataInputSchema = z
  .object({
    amountSompi: z.string().regex(/^[0-9]+$/, "Amount must be whole sompi."),
    claimPublicKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "Claim public key must be 32-byte hex."),
    feeSompi: z.string().regex(/^[0-9]+$/, "Fee must be whole sompi."),
    fundingAddress: z.string().min(1).max(200).refine(isValidMainnetAddress, {
      message: "Funding address must be a valid mainnet kaspa: address.",
    }),
    redeemScriptHex: z
      .string()
      .regex(/^[0-9a-fA-F]+$/, "Redeem script must be hex.")
      .max(4000, "Redeem script is too large.")
      .refine((value) => value.length % 2 === 0, "Redeem script must have even hex length."),
    refundLockTime: z.string().regex(/^[0-9]+$/, "Refund lock time must be a whole number."),
    refundPublicKey: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Refund public key must be 32-byte hex."),
  })
  .superRefine((value, context) => {
    const amountSompi = BigInt(value.amountSompi);
    const feeSompi = BigInt(value.feeSompi);
    const refundLockTime = BigInt(value.refundLockTime);

    if (amountSompi <= 0n) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claim amount must be greater than zero.",
        path: ["amountSompi"],
      });
    }
    if (amountSompi > MAX_POSTGRES_BIGINT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claim amount exceeds the supported integer range.",
        path: ["amountSompi"],
      });
    }
    if (feeSompi <= 0n || feeSompi >= amountSompi) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fee must be greater than zero and lower than the claim amount.",
        path: ["feeSompi"],
      });
    } else if (amountSompi - feeSompi < TOCCATA_CANARY_MIN_OUTPUT_SOMPI) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Claim output is below the reliable mainnet minimum after fees.",
        path: ["feeSompi"],
      });
    }
    if (feeSompi > MAX_POSTGRES_BIGINT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fee exceeds the supported integer range.",
        path: ["feeSompi"],
      });
    }
    if (refundLockTime <= 0n) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Refund lock time must be greater than zero.",
        path: ["refundLockTime"],
      });
    }
  });

export const toccataBatchClaimableScriptInputSchema = z.object({
  links: z
    .array(toccataClaimableScriptKeysSchema)
    .min(2, "A batch needs at least two links.")
    .max(25, "The private batch lab is limited to 25 links."),
  refundLockTime: z.string().regex(/^[0-9]+$/, "Refund lock time must be a whole number."),
});

export const toccataBatchAllocatorScriptInputSchema = z.object({
  activationPublicKey: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Activation public key must be 32-byte hex."),
  outputs: z
    .array(toccataBatchAllocatorOutputSchema)
    .min(2, "A batch allocator needs at least two outputs.")
    .max(10, "The batch allocator lab is limited to ten outputs."),
  refundLockTime: z.string().regex(/^[0-9]+$/, "Refund lock time must be a whole number."),
  refundPublicKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "Refund public key must be 32-byte hex."),
});

const registeredBatchOutputSchema = toccataBatchAllocatorOutputSchema.extend({
  linkKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, "Claimable link key is invalid."),
});

export const registeredClaimableBatchInputSchema = z
  .object({
    activationFeeSompi: z.string().regex(/^[0-9]+$/, "Activation fee must be whole sompi."),
    activationPublicKey: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Activation public key must be 32-byte hex."),
    batchKey: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/, "Batch key is invalid."),
    fundingAddress: z.string().min(1).max(200).refine(isValidMainnetAddress, {
      message: "Funding address must be a valid mainnet kaspa: address.",
    }),
    fundingAmountSompi: z.string().regex(/^[0-9]+$/, "Funding amount must be whole sompi."),
    outputs: z.array(registeredBatchOutputSchema).min(2).max(10),
    redeemScriptHex: z
      .string()
      .regex(/^[0-9a-fA-F]+$/, "Batch redeem script must be hex.")
      .max(12_000)
      .refine((value) => value.length % 2 === 0, "Batch redeem script must have even hex length."),
    refundLockTime: z.string().regex(/^[0-9]+$/, "Refund lock time must be a whole number."),
    refundPublicKey: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Refund public key must be 32-byte hex."),
    title: z.string().trim().min(1).max(80),
  })
  .superRefine((value, context) => {
    const fundingAmount = BigInt(value.fundingAmountSompi);
    const activationFee = BigInt(value.activationFeeSompi);
    const outputTotal = value.outputs.reduce(
      (total, output) => total + BigInt(output.amountSompi),
      0n,
    );
    if (activationFee <= 0n || fundingAmount !== outputTotal + activationFee) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Batch funding must equal all committed outputs plus the activation fee.",
        path: ["fundingAmountSompi"],
      });
    }
    if (fundingAmount > MAX_POSTGRES_BIGINT || activationFee > MAX_POSTGRES_BIGINT) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Batch amount exceeds the supported integer range.",
        path: ["fundingAmountSompi"],
      });
    }
    if (new Set(value.outputs.map((output) => output.linkKey)).size !== value.outputs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Batch output link keys must be unique.",
        path: ["outputs"],
      });
    }
  });

export const toccataFundingStatusInputSchema = z
  .object({
    amountSompi: z
      .string()
      .regex(/^[0-9]+$/, "Amount must be whole sompi.")
      .refine((value) => {
        const amountSompi = BigInt(value);
        return amountSompi > 0n;
      }, "Funding amount must be greater than zero."),
    fundingAddress: z.string().min(1).max(200).refine(isValidMainnetAddress, {
      message: "Funding address must be a valid mainnet kaspa: address.",
    }),
    fundingOutputIndex: z.number().int().nonnegative().optional(),
    fundingTransactionId: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "Funding transaction id must be 32-byte hex.")
      .optional(),
    linkKey: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_-]+$/, "Claimable link key is invalid.")
      .optional(),
    notBefore: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, context) => {
    const hasTransactionId = value.fundingTransactionId !== undefined;
    const hasOutputIndex = value.fundingOutputIndex !== undefined;
    if (hasTransactionId === hasOutputIndex) return;

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Funding transaction id and output index must be provided together.",
    });
  });

export const toccataClaimableBroadcastInputSchema = z.object({
  expectedTransactionId: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Expected transaction id must be 32-byte hex."),
  linkKey: z
    .string()
    .trim()
    .min(1, "Claimable link key is required.")
    .max(128, "Claimable link key is too long.")
    .regex(/^[a-zA-Z0-9_-]+$/, "Claimable link key is invalid."),
  transactionSafeJson: z
    .string()
    .min(1, "Signed transaction JSON is required.")
    .max(250_000, "Signed transaction JSON is too large."),
});

export const toccataBatchActivationBroadcastInputSchema = z.object({
  batchKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, "Batch key is invalid."),
  expectedTransactionId: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Expected transaction id must be 32-byte hex."),
  transactionSafeJson: z
    .string()
    .min(1, "Signed transaction JSON is required.")
    .max(250_000, "Signed transaction JSON is too large."),
});

export const toccataBatchRefundBroadcastInputSchema = z.object({
  batchKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, "Batch key is invalid."),
  expectedTransactionId: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Expected transaction id must be 32-byte hex."),
  refundLockTime: z.string().regex(/^[0-9]+$/, "Refund lock time must be a whole number."),
  transactionSafeJson: z
    .string()
    .min(1, "Signed transaction JSON is required.")
    .max(250_000, "Signed transaction JSON is too large."),
});

export const toccataLabIntentInputSchema = z.object({
  amountKas: z.string(),
  label: z
    .string()
    .optional()
    .nullable()
    .transform((value) => normalizeOptionalText(value, TOCCATA_LAB_DEFAULT_LABEL, 80)),
  message: z
    .string()
    .optional()
    .nullable()
    .transform((value) => normalizeOptionalText(value, null, 120)),
  recipientAddress: z.string().min(1).max(200),
});

export class ToccataLabSdkUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToccataLabSdkUnavailableError";
  }
}

export function isToccataLabEnabled(): boolean {
  return process.env.TOCCATA_LAB_ENABLED === "true";
}

// Separate opt-in for the unlinked, Caddy-gated batch experiment. This must
// never turn on simply because normal claimable links are enabled.
export function isToccataBatchLabEnabled(): boolean {
  return isToccataLabEnabled() && process.env.TOCCATA_BATCH_LAB_ENABLED === "true";
}

export function readToccataLabCapabilities(): ToccataSdkCapabilities {
  try {
    return assertToccataSdkReady();
  } catch (error) {
    throw new ToccataLabSdkUnavailableError((error as Error).message);
  }
}

export function getToccataLabCapabilityNames() {
  return TOCCATA_REQUIRED_CAPABILITIES;
}

export function createToccataLabIntent(input: ToccataLabIntentInput): ToccataLabIntent {
  const sdk = readToccataLabCapabilities();
  const address = validateMainnetAddress(input.recipientAddress);
  const amountSompi = parseBoundedMainnetLabAmount(input.amountKas);
  const amountKas = formatSompiToKaspa(amountSompi);
  const label =
    normalizeOptionalText(input.label, TOCCATA_LAB_DEFAULT_LABEL, 80) ?? TOCCATA_LAB_DEFAULT_LABEL;
  const message = normalizeOptionalText(input.message, null, 120);
  const uri = buildKaspaPaymentUri({
    amountSompi,
    label,
    message,
    recipientAddress: address,
  });
  const walletLaunchUri = buildKaspaPaymentUri({
    amountSompi,
    recipientAddress: address,
  });

  return {
    amountKas,
    amountSompi: amountSompi.toString(),
    label,
    message,
    network: "mainnet",
    recipientAddress: address,
    sdk,
    uri,
    walletLaunchUri,
  };
}

export function createToccataLabQrUri(input: ToccataLabIntentInput): string {
  return createToccataLabIntent(input).walletLaunchUri;
}

export function createToccataLabPsktSmokePrototype(): ToccataLabPsktSmokePrototype {
  try {
    return createToccataPsktSmokePrototype();
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("Kaspa Toccata SDK is missing")) {
      throw new ToccataLabSdkUnavailableError(message);
    }
    throw error;
  }
}

export function createToccataLabSafeJsonSmokePrototype(): ToccataLabSafeJsonSmokePrototype {
  try {
    return createToccataSafeJsonSmokePrototype();
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("Kaspa Toccata SDK is missing")) {
      throw new ToccataLabSdkUnavailableError(message);
    }
    throw error;
  }
}

export function createToccataClaimableLabScript(
  input: z.infer<typeof toccataClaimableScriptInputSchema>,
) {
  try {
    return buildToccataClaimableLabScript(input);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("Kaspa Toccata SDK is missing")) {
      throw new ToccataLabSdkUnavailableError(message);
    }
    throw error;
  }
}

export function validateRegisteredClaimableMetadata(
  input: z.infer<typeof registeredClaimableMetadataInputSchema>,
  options: { allowLegacyAmount?: boolean } = {},
) {
  const parsed = registeredClaimableMetadataInputSchema.parse(input);
  const amountSompi = BigInt(parsed.amountSompi);
  if (!options.allowLegacyAmount && amountSompi < TOCCATA_LAB_MIN_SOMPI) {
    throw new Error(`Claim amount must be at least ${TOCCATA_LAB_MIN_KAS} KAS.`);
  }
  const spendPlan = planToccataCanarySpend({
    feeSompi: parsed.feeSompi,
    utxoSompi: parsed.amountSompi,
  });
  if (!spendPlan.meetsMinimumOutput) {
    throw new Error("Claim output is below the reliable mainnet minimum after fees.");
  }

  const canonical = createToccataClaimableLabScript({
    linkPublicKey: parsed.claimPublicKey,
    refundLockTime: parsed.refundLockTime,
    refundPublicKey: parsed.refundPublicKey,
  });

  if (parsed.fundingAddress !== canonical.fundingAddress) {
    throw new Error("Funding address does not match the canonical claimable script.");
  }
  if (parsed.redeemScriptHex.toLowerCase() !== canonical.redeemScriptHex) {
    throw new Error("Redeem script does not match the canonical claimable script.");
  }

  return {
    amountSompi: spendPlan.utxoSompi,
    claimPublicKey: canonical.linkPublicKey,
    feeSompi: spendPlan.feeSompi,
    fundingAddress: canonical.fundingAddress,
    redeemScriptHex: canonical.redeemScriptHex,
    refundLockTime: canonical.refundLockTime,
    refundPublicKey: canonical.refundPublicKey,
  };
}

export function createToccataBatchAllocatorLabScript(
  input: z.infer<typeof toccataBatchAllocatorScriptInputSchema>,
) {
  try {
    return buildToccataBatchAllocatorLabScript(input);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("Kaspa Toccata SDK is missing")) {
      throw new ToccataLabSdkUnavailableError(message);
    }
    throw error;
  }
}

export function validateRegisteredClaimableBatchMetadata(
  input: z.infer<typeof registeredClaimableBatchInputSchema>,
) {
  const parsed = registeredClaimableBatchInputSchema.parse(input);
  const allocator = createToccataBatchAllocatorLabScript({
    activationPublicKey: parsed.activationPublicKey,
    outputs: parsed.outputs,
    refundLockTime: parsed.refundLockTime,
    refundPublicKey: parsed.refundPublicKey,
  });
  if (allocator.fundingAddress !== parsed.fundingAddress) {
    throw new Error("Batch funding address does not match the canonical allocator script.");
  }
  if (allocator.redeemScriptHex !== parsed.redeemScriptHex.toLowerCase()) {
    throw new Error("Batch redeem script does not match the canonical allocator script.");
  }

  return {
    activationFeeSompi: BigInt(parsed.activationFeeSompi),
    activationPublicKey: allocator.activationPublicKey,
    batchKey: parsed.batchKey,
    fundingAddress: allocator.fundingAddress,
    fundingAmountSompi: BigInt(parsed.fundingAmountSompi),
    outputs: parsed.outputs.map((output, index) => ({
      amountSompi: BigInt(output.amountSompi),
      linkKey: output.linkKey,
      scriptPublicKeyHex: allocator.outputs[index]!.scriptPublicKeyHex,
    })),
    redeemScriptHex: allocator.redeemScriptHex,
    refundLockTime: allocator.refundLockTime,
    refundPublicKey: allocator.refundPublicKey,
    title: parsed.title,
  };
}

export type ToccataClaimableBroadcastResult = {
  submittedTransactionId: string;
  transactionId: string;
};

const KASPA_WRPC_RELAY_TIMEOUT_MS = 55_000;

export async function broadcastToccataClaimableTransaction(
  input: z.infer<typeof toccataClaimableBroadcastInputSchema>,
): Promise<ToccataClaimableBroadcastResult> {
  const transactionId = validateClaimableBroadcastSafeJson(input.transactionSafeJson);

  if (
    input.expectedTransactionId !== undefined &&
    input.expectedTransactionId.toLowerCase() !== transactionId
  ) {
    throw new Error("Signed transaction id does not match the expected transaction id.");
  }

  const submittedTransactionId = await submitClaimableSafeJsonViaKaspaWrpcRelay(
    input.transactionSafeJson,
    transactionId,
  );

  return {
    submittedTransactionId,
    transactionId,
  };
}

export async function broadcastToccataBatchActivationTransaction(
  input: z.infer<typeof toccataBatchActivationBroadcastInputSchema>,
): Promise<ToccataClaimableBroadcastResult> {
  const transactionId = validateBatchActivationBroadcastSafeJson(input.transactionSafeJson);
  if (input.expectedTransactionId.toLowerCase() !== transactionId) {
    throw new Error("Signed batch activation id does not match the expected transaction id.");
  }

  const submittedTransactionId = await submitClaimableSafeJsonViaKaspaWrpcRelay(
    input.transactionSafeJson,
    transactionId,
  );
  return { submittedTransactionId, transactionId };
}

export async function broadcastToccataBatchRefundTransaction(
  input: z.infer<typeof toccataBatchRefundBroadcastInputSchema>,
): Promise<ToccataClaimableBroadcastResult> {
  const transactionId = validateClaimableBroadcastSafeJson(input.transactionSafeJson);
  if (input.expectedTransactionId.toLowerCase() !== transactionId) {
    throw new Error("Signed batch refund id does not match the expected transaction id.");
  }
  const submittedTransactionId = await submitClaimableSafeJsonViaKaspaWrpcRelay(
    input.transactionSafeJson,
    transactionId,
  );
  return { submittedTransactionId, transactionId };
}

async function submitClaimableSafeJsonViaKaspaWrpcRelay(
  transactionSafeJson: string,
  expectedTransactionId: string,
): Promise<string> {
  const relayUrl = readToccataWrpcRelayUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, KASPA_WRPC_RELAY_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/submit", relayUrl), {
      body: JSON.stringify({ expectedTransactionId, transactionSafeJson }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    const parsed = await readRelayJsonResponse(response);

    if (!response.ok) {
      const message = readRelayErrorMessage(parsed) ?? `Relay returned ${response.status}.`;
      throw new Error(`Kaspa wRPC relay rejected transaction ${expectedTransactionId}: ${message}`);
    }

    const localTransactionId = parseOptionalHexField(parsed, "localTransactionId");
    if (localTransactionId !== expectedTransactionId) {
      throw new Error("Signed transaction id changed during wRPC submit preparation.");
    }

    return parseOptionalHexField(parsed, "submittedTransactionId") ?? expectedTransactionId;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Kaspa wRPC relay timed out after ${KASPA_WRPC_RELAY_TIMEOUT_MS}ms.`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function readToccataWrpcRelayUrl(): string {
  const relayUrl = process.env.TOCCATA_WRPC_RELAY_URL?.trim();
  if (!relayUrl) {
    throw new Error("TOCCATA_WRPC_RELAY_URL is not configured.");
  }
  return relayUrl.endsWith("/") ? relayUrl.slice(0, -1) : relayUrl;
}

async function readRelayJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const parsed = parseJsonRecord(text);
  if (parsed === null) {
    throw new Error(`Kaspa wRPC relay returned non-JSON response (${response.status}).`);
  }
  return parsed;
}

function readRelayErrorMessage(value: Record<string, unknown>): null | string {
  const error = value.error;
  if (!isRecord(error)) return null;
  const message = error.message;
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}

type SafeJsonClaimableTransaction = {
  id?: unknown;
  inputs?: unknown;
  lockTime?: unknown;
  outputs?: unknown;
  subnetworkId?: unknown;
  version?: unknown;
};

type SafeJsonClaimableInput = {
  computeBudget?: unknown;
  index?: unknown;
  sequence?: unknown;
  sigOpCount?: unknown;
  signatureScript?: unknown;
  transactionId?: unknown;
  utxo?: unknown;
};

type SafeJsonClaimableOutput = {
  scriptPublicKey?: unknown;
  value?: unknown;
};

export type ClaimableBroadcastSafeJsonSummary = {
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  lockTime: string;
  outputAmountSompi: string;
  signatureScriptHex: string;
  transactionId: string;
};

export function readClaimableBroadcastSafeJsonSummary(
  transactionSafeJson: string,
): ClaimableBroadcastSafeJsonSummary {
  let parsed: SafeJsonClaimableTransaction;
  try {
    parsed = JSON.parse(transactionSafeJson) as SafeJsonClaimableTransaction;
  } catch {
    throw new Error("Signed transaction JSON could not be parsed.");
  }

  if (parsed.version !== 1) {
    throw new Error("Only v1 Toccata transactions can be broadcast.");
  }
  if (!isHexString(parsed.id, 64)) {
    throw new Error("Signed transaction JSON is missing a valid transaction id.");
  }
  if (!Array.isArray(parsed.inputs) || parsed.inputs.length !== 1) {
    throw new Error("Claimable broadcast accepts exactly one signed input.");
  }
  if (!Array.isArray(parsed.outputs) || parsed.outputs.length !== 1) {
    throw new Error("Claimable broadcast accepts exactly one output.");
  }
  if (!isHexString(parsed.subnetworkId, 40)) {
    throw new Error("Signed transaction JSON is missing a valid subnetwork id.");
  }

  const input = parsed.inputs[0] as SafeJsonClaimableInput;
  const output = parsed.outputs[0] as SafeJsonClaimableOutput;
  const outputAmountSompi = parseLabPositiveBigInt(output.value, "Output amount");

  parseComputeBudget(input.computeBudget);
  const fundingOutputIndex = parseOutputIndex(input.index);
  const fundingTransactionId = parseTransactionId(input.transactionId);
  parseSequence(input.sequence);
  parseSigOpCount(input.sigOpCount);
  const signatureScriptHex = parseSignatureScript(input.signatureScript);
  const lockTime = parseLockTimeBigInt(parsed.lockTime);
  const fundingAmountSompi = parseClaimableInputUtxoAmount(input.utxo);
  parseSafeJsonScriptPublicKey(output.scriptPublicKey);

  return {
    fundingAmountSompi: fundingAmountSompi.toString(),
    fundingOutputIndex,
    fundingTransactionId,
    lockTime: lockTime.toString(),
    outputAmountSompi: outputAmountSompi.toString(),
    signatureScriptHex,
    transactionId: parsed.id,
  };
}

export function readClaimableSpendMode(
  signatureScriptHex: string,
  redeemScriptHex: string,
): "claim" | "refund" {
  const normalizedSignatureScript = normalizeEvenHex(signatureScriptHex, "Signature script");
  const normalizedRedeemScript = normalizeEvenHex(redeemScriptHex, "Redeem script");
  const redeemPush = `${encodeScriptDataPushPrefix(normalizedRedeemScript.length / 2)}${normalizedRedeemScript}`;

  if (!normalizedSignatureScript.endsWith(redeemPush)) {
    throw new Error("Signed transaction does not reveal the registered claimable script.");
  }

  const innerScript = normalizedSignatureScript.slice(0, -redeemPush.length);
  if (innerScript.length < 4) {
    throw new Error("Signed transaction claimable branch is missing.");
  }

  const branchOpcode = innerScript.slice(-2);
  if (branchOpcode === "51") return "claim";
  if (branchOpcode === "00") return "refund";
  throw new Error("Signed transaction has an invalid claimable branch selector.");
}

export function validateClaimableBroadcastSafeJson(transactionSafeJson: string): string {
  return readClaimableBroadcastSafeJsonSummary(transactionSafeJson).transactionId;
}

export type BatchActivationBroadcastSafeJsonSummary = {
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  lockTime: string;
  outputs: Array<{ amountSompi: string; scriptPublicKeyHex: string }>;
  signatureScriptHex: string;
  transactionId: string;
};

export function readBatchActivationBroadcastSafeJsonSummary(
  transactionSafeJson: string,
): BatchActivationBroadcastSafeJsonSummary {
  let parsed: SafeJsonClaimableTransaction;
  try {
    parsed = JSON.parse(transactionSafeJson) as SafeJsonClaimableTransaction;
  } catch {
    throw new Error("Signed batch activation JSON could not be parsed.");
  }

  if (parsed.version !== 1 || !isHexString(parsed.id, 64)) {
    throw new Error("Signed batch activation JSON has an invalid Toccata transaction id.");
  }
  if (!Array.isArray(parsed.inputs) || parsed.inputs.length !== 1) {
    throw new Error("Batch activation accepts exactly one signed batch input.");
  }
  if (!Array.isArray(parsed.outputs) || parsed.outputs.length < 2 || parsed.outputs.length > 10) {
    throw new Error("Batch activation must create between 2 and 10 outputs.");
  }
  if (!isHexString(parsed.subnetworkId, 40)) {
    throw new Error("Signed batch activation JSON is missing a valid subnetwork id.");
  }

  const input = parsed.inputs[0] as SafeJsonClaimableInput;
  parseComputeBudget(input.computeBudget);
  const fundingOutputIndex = parseOutputIndex(input.index);
  const fundingTransactionId = parseTransactionId(input.transactionId);
  parseSequence(input.sequence);
  parseSigOpCount(input.sigOpCount);
  const signatureScriptHex = parseSignatureScript(input.signatureScript);
  const lockTime = parseLockTimeBigInt(parsed.lockTime);
  const fundingAmountSompi = parseClaimableInputUtxoAmount(input.utxo);

  const outputs = parsed.outputs.map((output) => {
    const candidate = output as SafeJsonClaimableOutput;
    return {
      amountSompi: parseLabPositiveBigInt(
        candidate.value,
        "Batch activation output amount",
      ).toString(),
      scriptPublicKeyHex: parseSafeJsonScriptPublicKey(candidate.scriptPublicKey),
    };
  });

  return {
    fundingAmountSompi: fundingAmountSompi.toString(),
    fundingOutputIndex,
    fundingTransactionId,
    lockTime: lockTime.toString(),
    outputs,
    signatureScriptHex,
    transactionId: parsed.id.toLowerCase(),
  };
}

export function validateBatchActivationBroadcastSafeJson(transactionSafeJson: string): string {
  return readBatchActivationBroadcastSafeJsonSummary(transactionSafeJson).transactionId;
}

function parseSafeJsonScriptPublicKey(value: unknown): string {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!/^[0-9a-f]+$/.test(normalized) || normalized.length < 6 || normalized.length % 2 !== 0) {
      throw new Error("Output scriptPublicKey must be hex.");
    }

    return normalized;
  }

  if (isRecord(value)) {
    const version = value.version;
    const script = value.script ?? value.scriptPublicKey;
    if (
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 0 ||
      version > 65_535
    ) {
      throw new Error("Output scriptPublicKey version is invalid.");
    }
    if (!isEvenHexString(script)) {
      throw new Error("Output scriptPublicKey script must be hex.");
    }

    return version.toString(16).padStart(4, "0") + script.toLowerCase();
  }

  throw new Error("Output scriptPublicKey is invalid.");
}

function parseSignatureScript(value: unknown): string {
  if (!isEvenHexString(value) || value.length === 0) {
    throw new Error("Signed transaction input is missing a signature script.");
  }
  return value;
}

function parseTransactionId(value: unknown): string {
  if (!isHexString(value, 64)) {
    throw new Error("Signed transaction input has an invalid funding transaction id.");
  }
  return value;
}

function parseComputeBudget(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("Signed transaction input has an invalid compute budget.");
  }
  return value;
}

function parseOutputIndex(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("Signed transaction input has an invalid output index.");
  }
  return value;
}

function parseSequence(value: unknown): number {
  const parsed = parseLabSafeNumber(value, "Input sequence");
  if (parsed < 0) {
    throw new Error("Input sequence must not be negative.");
  }
  return parsed;
}

function parseSigOpCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("Signed transaction input has an invalid sigOpCount.");
  }
  return value;
}

function parseLockTimeBigInt(value: unknown): bigint {
  const raw = typeof value === "number" ? value.toString() : typeof value === "string" ? value : "";
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error("Lock time must be a whole number.");
  }
  return BigInt(raw);
}

function parseClaimableInputUtxoAmount(value: unknown): bigint {
  if (!isRecord(value)) {
    throw new Error("Signed transaction input is missing its funding UTXO metadata.");
  }
  return parseLabPositiveBigInt(value.amount, "Funding UTXO amount");
}

function normalizeEvenHex(value: unknown, label: string): string {
  if (!isEvenHexString(value) || value.length === 0) {
    throw new Error(`${label} must be non-empty even-length hex.`);
  }
  return value.toLowerCase();
}

function encodeScriptDataPushPrefix(length: number): string {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error("Redeem script length is invalid.");
  }
  if (length <= 75) return length.toString(16).padStart(2, "0");
  if (length <= 0xff) return `4c${length.toString(16).padStart(2, "0")}`;
  if (length <= 0xffff) {
    const low = length & 0xff;
    const high = (length >> 8) & 0xff;
    return `4d${low.toString(16).padStart(2, "0")}${high.toString(16).padStart(2, "0")}`;
  }
  throw new Error("Redeem script is too large for a claimable-link signature script.");
}

function parseLabSafeNumber(value: unknown, label: string): number {
  const raw = typeof value === "number" ? value.toString() : typeof value === "string" ? value : "";
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${label} must be a whole number.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return parsed;
}

function parseLabPositiveBigInt(value: unknown, label: string): bigint {
  const raw = typeof value === "number" ? value.toString() : typeof value === "string" ? value : "";
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${label} must be a whole number.`);
  }
  const parsed = BigInt(raw);
  if (parsed <= 0n) {
    throw new Error(`${label} must be greater than zero.`);
  }
  return parsed;
}

function isHexString(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value);
}

function isEvenHexString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  if (value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseOptionalHexField(
  value: Record<string, unknown> | null,
  field: string,
): null | string {
  if (value === null) return null;
  const candidate = value[field];
  return isHexString(candidate, 64) ? candidate.toLowerCase() : null;
}

function parseBoundedMainnetLabAmount(amountKas: string): bigint {
  const amountSompi = parseKaspaAmountToSompi(amountKas);
  if (amountSompi < TOCCATA_LAB_MIN_SOMPI) {
    throw new Error(`Claimable link amount must be at least ${TOCCATA_LAB_MIN_KAS} KAS.`);
  }
  assertReliableMainnetOutputAmount(amountSompi, "Claimable link amount");
  return amountSompi;
}

function validateMainnetAddress(address: string): string {
  const validation = validateKaspaAddress(address);
  if (!validation.valid) {
    throw new Error(validation.reason);
  }
  if (validation.network !== "mainnet") {
    throw new Error("Claimable links only accept mainnet kaspa: addresses.");
  }
  return validation.address;
}

function isValidMainnetAddress(address: string): boolean {
  const validation = validateKaspaAddress(address);
  return validation.valid && validation.network === "mainnet";
}

function normalizeOptionalText(
  value: null | string | undefined,
  fallback: null | string,
  maxLength: number,
): null | string {
  const trimmed = value?.trim() ?? "";
  const normalized = trimmed.length > 0 ? trimmed : fallback;

  if (normalized !== null && normalized.length > maxLength) {
    throw new Error(`Text must not exceed ${maxLength} characters.`);
  }

  return normalized;
}
