import { z } from "zod";

import type { ClaimableStoreRecord } from "./claimable-store";
import { deriveToccataLabKeyPair } from "./toccata-lab-keys";

const hex32Schema = z.string().regex(/^[0-9a-f]{64}$/i);
const positiveIntegerSchema = z.string().regex(/^[1-9][0-9]*$/);
const nonNegativeIntegerSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

export const giveawayPrizeRecoveryRecordSchema = z.object({
  amountKas: z.string().min(1).max(40),
  amountSompi: positiveIntegerSchema,
  claimCode: hex32Schema,
  claimPublicKey: hex32Schema,
  createdAt: z.string().datetime(),
  createdAtMs: z.number().int().positive(),
  description: z.string().max(280),
  feeKas: z.string().min(1).max(40),
  feeSompi: positiveIntegerSchema,
  fundingAddress: z.string().startsWith("kaspa:").max(128),
  linkKey: z.string().min(1).max(128),
  netClaimKas: z.string().min(1).max(40),
  redeemScriptHex: z.string().regex(/^[0-9a-f]+$/i),
  refundCode: hex32Schema,
  refundLockTime: nonNegativeIntegerSchema,
  refundPublicKey: hex32Schema,
  title: z.string().min(1).max(80),
});

const giveawayPrizeRecoveryBundleSchema = z.object({
  exportedAt: z.string().datetime(),
  format: z.literal("kaspalinks-giveaway-prize-recovery"),
  prize: giveawayPrizeRecoveryRecordSchema,
  version: z.literal(1),
  warning: z.string(),
});

export type GiveawayPrizeRecoveryRecord = z.infer<typeof giveawayPrizeRecoveryRecordSchema>;
export type GiveawayPrizeRecoveryBundle = z.infer<typeof giveawayPrizeRecoveryBundleSchema>;

export function createGiveawayPrizeRecoveryBundle(
  prize: GiveawayPrizeRecoveryRecord,
  exportedAt = new Date().toISOString(),
): GiveawayPrizeRecoveryBundle {
  const validated = giveawayPrizeRecoveryRecordSchema.parse(prize);
  assertRecoveryKeys(validated);
  return {
    exportedAt,
    format: "kaspalinks-giveaway-prize-recovery",
    prize: validated,
    version: 1,
    warning:
      "PRIVATE GIVEAWAY PRIZE DATA. Anyone with this file can pay the parked prize or refund it after expiry. Keep it private and offline.",
  };
}

export function parseGiveawayPrizeRecoveryBundle(raw: string): GiveawayPrizeRecoveryBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Prize recovery file is not valid JSON.");
  }
  const result = giveawayPrizeRecoveryBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Prize recovery file is invalid.");
  }
  assertRecoveryKeys(result.data.prize);
  return result.data;
}

export function prizeRecoveryToLocalRecord(
  prize: GiveawayPrizeRecoveryRecord,
): ClaimableStoreRecord {
  assertRecoveryKeys(prize);
  return {
    amountKas: prize.amountKas,
    claimCode: prize.claimCode,
    claimUrl: "",
    createdAt: prize.createdAt,
    createdAtMs: prize.createdAtMs,
    description: prize.description,
    feeKas: prize.feeKas,
    fundingAddress: prize.fundingAddress,
    id: prize.linkKey,
    manageUrl: "",
    netClaimKas: prize.netClaimKas,
    refundCode: prize.refundCode,
    refundLockTime: prize.refundLockTime,
    status: "awaiting_funding",
    title: prize.title,
    updatedAtMs: Date.now(),
    validFor: `Until Kaspa DAA ${prize.refundLockTime}`,
  };
}

function assertRecoveryKeys(prize: GiveawayPrizeRecoveryRecord): void {
  if (
    deriveToccataLabKeyPair(prize.claimCode).xOnlyPublicKey !== prize.claimPublicKey.toLowerCase()
  ) {
    throw new Error("Prize recovery claim key does not match its public key.");
  }
  if (
    deriveToccataLabKeyPair(prize.refundCode).xOnlyPublicKey !== prize.refundPublicKey.toLowerCase()
  ) {
    throw new Error("Prize recovery refund key does not match its public key.");
  }
  if (Date.parse(prize.createdAt) !== prize.createdAtMs) {
    throw new Error("Prize recovery timestamp is inconsistent.");
  }
  const amount = BigInt(prize.amountSompi);
  const fee = BigInt(prize.feeSompi);
  if (fee <= 0n || fee >= amount) {
    throw new Error("Prize recovery amount and fee are inconsistent.");
  }
}
