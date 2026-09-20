import type { EscrowLinkPrototype } from "@kaspa-actions/db";
import { z } from "zod";

import {
  ESCROW_CANARY_AMOUNT_SOMPI,
  ESCROW_CANARY_FEE_SOMPI,
  type EscrowV1StoredRecord,
} from "./escrow-canary";

export const ESCROW_LINK_DURATIONS_DAA = [36_000n, 216_000n, 864_000n] as const;

const xOnlyPublicKey = z.string().regex(/^[0-9a-f]{64}$/u);
const publicId = z.string().cuid();
const mode = z.enum(["release", "refund", "claim"]);

export const escrowLinkCreateSchema = z
  .object({
    durationDaa: z
      .string()
      .max(10)
      .regex(/^\d+$/u)
      .refine((value) => ESCROW_LINK_DURATIONS_DAA.some((duration) => duration === BigInt(value))),
    sellerAddress: z.string().trim().min(20).max(150),
    sellerPublicKey: xOnlyPublicKey,
    signerContextId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u),
    title: z.string().trim().min(3).max(80),
  })
  .strict();

export const escrowLinkPublicIdSchema = publicId;

export const escrowLinkPublicActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("join"),
      buyerAddress: z.string().trim().min(20).max(150),
      buyerPublicKey: xOnlyPublicKey,
    })
    .strict(),
  z.object({ action: z.literal("prepare"), mode }).strict(),
  z
    .object({
      action: z.literal("broadcast"),
      mode,
      transactionSafeJson: z.string().min(1).max(100_000),
    })
    .strict(),
]);

export function escrowLinkFundingSompi(row: Pick<EscrowLinkPrototype, "amountSompi" | "feeSompi">) {
  return row.amountSompi + row.feeSompi;
}

export function assertEscrowLinkConstants(
  row: Pick<EscrowLinkPrototype, "amountSompi" | "durationDaa" | "feeSompi">,
) {
  if (
    row.amountSompi !== ESCROW_CANARY_AMOUNT_SOMPI ||
    row.feeSompi !== ESCROW_CANARY_FEE_SOMPI ||
    !ESCROW_LINK_DURATIONS_DAA.some((duration) => duration === row.durationDaa)
  ) {
    throw new Error("Stored escrow terms do not match this release.");
  }
}

export function joinedEscrowLinkRecord(row: EscrowLinkPrototype): EscrowV1StoredRecord {
  assertEscrowLinkConstants(row);
  if (
    !row.activeFundingAddress ||
    !row.frozenFundingAddress ||
    !row.buyerAddress ||
    !row.buyerPublicKey ||
    row.releaseAfter === null
  ) {
    throw new Error("The buyer has not accepted this escrow yet.");
  }
  return {
    activeFundingAddress: row.activeFundingAddress,
    amountSompi: row.amountSompi,
    buyerAddress: row.buyerAddress,
    buyerPublicKey: row.buyerPublicKey,
    claimTxId: row.claimTxId,
    feeSompi: row.feeSompi,
    frozenFundingAddress: row.frozenFundingAddress,
    refundTxId: row.refundTxId,
    releaseAfter: row.releaseAfter,
    releaseTxId: row.releaseTxId,
    sellerAddress: row.sellerAddress,
    sellerPublicKey: row.sellerPublicKey,
  };
}
