import { z } from "zod";

import { deriveToccataLabKeyPair } from "./toccata-lab-keys";

const hex32Schema = z.string().regex(/^[0-9a-f]{64}$/i);
const positiveIntegerSchema = z.string().regex(/^[1-9][0-9]*$/);
const nonNegativeIntegerSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

const fundingMatchSchema = z.object({
  amountSompi: positiveIntegerSchema,
  blockTime: z.number().int().nonnegative().nullable(),
  outputIndex: z.number().int().nonnegative(),
  transactionId: hex32Schema,
});

const batchLinkSchema = z.object({
  amountKas: z.string().min(1).max(40),
  amountSompi: positiveIntegerSchema,
  claimCode: hex32Schema,
  claimPublicKey: hex32Schema,
  description: z.string().max(180),
  feeKas: z.string().min(1).max(40),
  feeSompi: positiveIntegerSchema,
  fundingAddress: z.string().startsWith("kaspa:").max(128),
  fundingMatch: fundingMatchSchema.nullable(),
  hidden: z.boolean().optional(),
  id: z.string().min(1).max(120),
  netClaimKas: z.string().min(1).max(40),
  redeemScriptHex: z.string().regex(/^[0-9a-f]+$/i),
  refundCode: hex32Schema,
  refundLockTime: nonNegativeIntegerSchema,
  refundPublicKey: hex32Schema,
  scriptPublicKeyHex: z.string().regex(/^[0-9a-f]+$/i),
  status: z.enum(["awaiting_activation", "funded", "spent"]),
  title: z.string().min(1).max(80),
});

export const batchRecordSchema = z.object({
  activation: z.object({
    activationCode: hex32Schema,
    activationPublicKey: hex32Schema,
    activationFeeSompi: positiveIntegerSchema,
    fundingAddress: z.string().startsWith("kaspa:").max(128),
    fundingAmountSompi: positiveIntegerSchema,
    fundingMatch: fundingMatchSchema.nullable(),
    redeemScriptHex: z.string().regex(/^[0-9a-f]+$/i),
    refundCode: hex32Schema,
    refundPublicKey: hex32Schema,
    status: z.enum(["awaiting_funding", "funded", "activated", "refunded"]),
  }),
  createdAt: z.string().datetime(),
  createdAtMs: z.number().int().positive(),
  id: z.string().min(1).max(120),
  links: z.array(batchLinkSchema).min(2).max(10),
  batchManifestRegisteredAt: z.string().datetime().optional(),
  recoveryExportedAt: z.string().datetime().optional(),
  registrationCompleteAt: z.string().datetime().optional(),
  title: z.string().min(1).max(80),
  updatedAtMs: z.number().int().positive().optional(),
  validFor: z.string().min(1).max(80),
  version: z.literal(2),
});

const recoveryBundleSchema = z.object({
  batch: batchRecordSchema,
  exportedAt: z.string().datetime(),
  format: z.literal("kaspalinks-claimable-batch-recovery"),
  warning: z.string(),
  version: z.literal(1),
});

export type BatchRecoveryRecord = z.infer<typeof batchRecordSchema>;
export type BatchRecoveryBundle = z.infer<typeof recoveryBundleSchema>;

export function createBatchRecoveryBundle(
  batch: BatchRecoveryRecord,
  exportedAt = new Date().toISOString(),
): BatchRecoveryBundle {
  return {
    batch,
    exportedAt,
    format: "kaspalinks-claimable-batch-recovery",
    version: 1,
    warning:
      "PRIVATE RECOVERY DATA. Anyone with this file can claim or refund its KAS. Never upload or share it.",
  };
}

export function parseBatchRecoveryBundle(raw: string): BatchRecoveryBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Recovery file is not valid JSON.");
  }

  const result = recoveryBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Recovery file has an invalid format.");
  }

  assertRecoveryKeysMatch(result.data.batch);
  assertRecoveryAmountsAndState(result.data.batch);
  return result.data;
}

function assertRecoveryKeysMatch(batch: BatchRecoveryRecord): void {
  if (
    deriveToccataLabKeyPair(batch.activation.activationCode).xOnlyPublicKey !==
    batch.activation.activationPublicKey.toLowerCase()
  ) {
    throw new Error("Recovery file activation key does not match its public key.");
  }
  if (
    deriveToccataLabKeyPair(batch.activation.refundCode).xOnlyPublicKey !==
    batch.activation.refundPublicKey.toLowerCase()
  ) {
    throw new Error("Recovery file batch refund key does not match its public key.");
  }

  for (const link of batch.links) {
    if (
      deriveToccataLabKeyPair(link.claimCode).xOnlyPublicKey !== link.claimPublicKey.toLowerCase()
    ) {
      throw new Error(`Recovery key for “${link.title}” does not match its public key.`);
    }
    if (
      deriveToccataLabKeyPair(link.refundCode).xOnlyPublicKey !== link.refundPublicKey.toLowerCase()
    ) {
      throw new Error(`Refund key for “${link.title}” does not match its public key.`);
    }
  }

  const privateCodes = [
    batch.activation.activationCode,
    batch.activation.refundCode,
    ...batch.links.flatMap((link) => [link.claimCode, link.refundCode]),
  ];
  if (new Set(privateCodes.map((value) => value.toLowerCase())).size !== privateCodes.length) {
    throw new Error("Recovery file reuses a private code across multiple contract roles.");
  }
}

function assertRecoveryAmountsAndState(batch: BatchRecoveryRecord): void {
  if (Date.parse(batch.createdAt) !== batch.createdAtMs) {
    throw new Error("Recovery file creation timestamp is inconsistent.");
  }
  if (new Set(batch.links.map((link) => link.id)).size !== batch.links.length) {
    throw new Error("Recovery file contains duplicate link identifiers.");
  }

  const activationFee = BigInt(batch.activation.activationFeeSompi);
  const childTotal = batch.links.reduce((total, link) => {
    const amount = BigInt(link.amountSompi);
    const fee = BigInt(link.feeSompi);
    if (fee <= 0n || fee >= amount) {
      throw new Error(`Recovery amounts for “${link.title}” are inconsistent.`);
    }
    if (link.refundLockTime !== batch.links[0]!.refundLockTime) {
      throw new Error("Recovery file child refund lock times do not match.");
    }
    if (link.fundingMatch && link.fundingMatch.amountSompi !== link.amountSompi) {
      throw new Error(`Recovery funding amount for “${link.title}” is inconsistent.`);
    }
    return total + amount;
  }, 0n);
  if (
    activationFee <= 0n ||
    childTotal + activationFee !== BigInt(batch.activation.fundingAmountSompi)
  ) {
    throw new Error("Recovery file batch funding total is inconsistent.");
  }
  if (
    batch.activation.fundingMatch &&
    batch.activation.fundingMatch.amountSompi !== batch.activation.fundingAmountSompi
  ) {
    throw new Error("Recovery file allocator funding amount is inconsistent.");
  }

  const activationStatus = batch.activation.status;
  if (activationStatus === "awaiting_funding" && batch.activation.fundingMatch) {
    throw new Error("Recovery file funding state is inconsistent.");
  }
  if (
    (activationStatus === "funded" ||
      activationStatus === "activated" ||
      activationStatus === "refunded") &&
    !batch.activation.fundingMatch
  ) {
    throw new Error("Recovery file is missing its allocator funding outpoint.");
  }
  if (activationStatus === "activated") {
    const activationTxIds = new Set(
      batch.links.map((link, outputIndex) => {
        if (!link.fundingMatch || link.fundingMatch.outputIndex !== outputIndex) {
          throw new Error("Recovery file child activation outpoints are inconsistent.");
        }
        return link.fundingMatch.transactionId;
      }),
    );
    if (activationTxIds.size !== 1) {
      throw new Error("Recovery file child activation transaction ids do not match.");
    }
  }
}
