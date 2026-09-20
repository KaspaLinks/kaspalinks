import { createRequire } from "node:module";

import type { EscrowPrototype } from "@kaspa-actions/db";
import {
  assertEscrowV1SigningIntent,
  buildEscrowV1Address,
  buildEscrowV1Transaction,
  buildKaspaAddressScriptPublicKeyHex,
  type EscrowV1Parameters,
  type EscrowV1Spend,
} from "@kaspa-actions/kaspa";
import { z } from "zod";

import type { PrototypeUtxo } from "./giveaway-prize-v3-prototype";

const kaspa = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");

export const ESCROW_CANARY_AMOUNT_SOMPI = 21_000_000n;
export const ESCROW_CANARY_FEE_SOMPI = 1_000_000n;
export const ESCROW_CANARY_FUNDING_SOMPI = ESCROW_CANARY_AMOUNT_SOMPI + ESCROW_CANARY_FEE_SOMPI;
export const ESCROW_CANARY_COMPUTE_BUDGET = 50;
export const ESCROW_CANARY_DURATION_DAA = 36_000n;

const xOnlyPublicKey = z.string().regex(/^[0-9a-f]{64}$/u);
const canaryId = z.string().cuid();
const mode = z.enum(["release", "refund", "claim"]);

export type EscrowCanaryMode = z.infer<typeof mode>;

export type EscrowV1StoredRecord = Pick<
  EscrowPrototype,
  | "activeFundingAddress"
  | "amountSompi"
  | "buyerAddress"
  | "buyerPublicKey"
  | "claimTxId"
  | "feeSompi"
  | "frozenFundingAddress"
  | "refundTxId"
  | "releaseAfter"
  | "releaseTxId"
  | "sellerAddress"
  | "sellerPublicKey"
>;

export const escrowCanaryActionSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("create"),
        buyerPublicKey: xOnlyPublicKey,
        payoutAddress: z.string().trim().min(20).max(150),
        sellerPublicKey: xOnlyPublicKey,
        signerContextId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u),
      })
      .strict(),
    z.object({ action: z.literal("prepare"), id: canaryId, mode }).strict(),
    z
      .object({
        action: z.literal("broadcast"),
        id: canaryId,
        mode,
        transactionSafeJson: z.string().min(1).max(100_000),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.action === "create" && value.buyerPublicKey === value.sellerPublicKey) {
      context.addIssue({
        code: "custom",
        message: "Buyer and seller signer roles must be domain-separated.",
        path: ["sellerPublicKey"],
      });
    }
  });

export type EscrowCanaryAction = z.infer<typeof escrowCanaryActionSchema>;

export function createEscrowCanaryTerms(input: {
  buyerPublicKey: string;
  chainDaa: bigint;
  payoutAddress: string;
  sellerPublicKey: string;
}) {
  return createEscrowV1Terms({
    amount: ESCROW_CANARY_AMOUNT_SOMPI,
    buyerAddress: input.payoutAddress,
    buyerPublicKey: input.buyerPublicKey,
    fee: ESCROW_CANARY_FEE_SOMPI,
    releaseAfter: input.chainDaa + ESCROW_CANARY_DURATION_DAA,
    sellerAddress: input.payoutAddress,
    sellerPublicKey: input.sellerPublicKey,
  });
}

export function createEscrowV1Terms(input: {
  amount: bigint;
  buyerAddress: string;
  buyerPublicKey: string;
  fee: bigint;
  releaseAfter: bigint;
  sellerAddress: string;
  sellerPublicKey: string;
}) {
  const parameters: EscrowV1Parameters = {
    amount: input.amount,
    fee: input.fee,
    releaseAfter: input.releaseAfter,
    buyerPublicKey: input.buyerPublicKey,
    sellerPublicKey: input.sellerPublicKey,
    buyerScriptPublicKey: buildKaspaAddressScriptPublicKeyHex(input.buyerAddress),
    sellerScriptPublicKey: buildKaspaAddressScriptPublicKeyHex(input.sellerAddress),
  };
  const active = buildEscrowV1Address(parameters, "active");
  const frozen = buildEscrowV1Address(parameters, "frozen");
  return { active, frozen, parameters };
}

export function escrowCanaryParameters(row: EscrowV1StoredRecord): EscrowV1Parameters {
  return {
    amount: row.amountSompi,
    fee: row.feeSompi,
    releaseAfter: row.releaseAfter,
    buyerPublicKey: row.buyerPublicKey,
    sellerPublicKey: row.sellerPublicKey,
    buyerScriptPublicKey: buildKaspaAddressScriptPublicKeyHex(row.buyerAddress),
    sellerScriptPublicKey: buildKaspaAddressScriptPublicKeyHex(row.sellerAddress),
  };
}

export function selectEscrowCanaryUtxo(
  utxos: PrototypeUtxo[],
):
  | { state: "awaiting_funding"; utxo: null }
  | { state: "funded"; utxo: PrototypeUtxo }
  | { state: "ambiguous"; utxo: null } {
  const matches = utxos.filter((utxo) => BigInt(utxo.amount) === ESCROW_CANARY_FUNDING_SOMPI);
  if (matches.length === 0) return { state: "awaiting_funding", utxo: null };
  if (matches.length > 1) return { state: "ambiguous", utxo: null };
  return { state: "funded", utxo: matches[0]! };
}

export function buildEscrowCanarySpend(
  row: EscrowV1StoredRecord,
  selectedMode: EscrowCanaryMode,
  utxo: PrototypeUtxo,
): EscrowV1Spend {
  const parameters = escrowCanaryParameters(row);
  const active = buildEscrowV1Address(parameters, "active");
  if (active.address !== row.activeFundingAddress) {
    throw new Error("Stored escrow address no longer matches its public commitment.");
  }
  return {
    parameters,
    phase: "active",
    mode: selectedMode,
    computeBudget: ESCROW_CANARY_COMPUTE_BUDGET,
    utxo: {
      ...utxo,
      scriptPublicKeyHex: active.scriptPublicKeyHex,
    },
  };
}

export function prepareEscrowCanaryTransaction(
  row: EscrowV1StoredRecord,
  selectedMode: EscrowCanaryMode,
  utxo: PrototypeUtxo,
) {
  const spend = buildEscrowCanarySpend(row, selectedMode, utxo);
  const prepared = buildEscrowV1Transaction(spend);
  return {
    ...prepared,
    review: {
      amountSompi: row.amountSompi.toString(),
      computeBudget: ESCROW_CANARY_COMPUTE_BUDGET,
      destinationAddress: selectedMode === "refund" ? row.buyerAddress : row.sellerAddress,
      feeSompi: row.feeSompi.toString(),
      fundingOutputIndex: utxo.index,
      fundingTransactionId: utxo.transactionId,
      mode: selectedMode,
      lockTime: selectedMode === "claim" ? row.releaseAfter.toString() : "0",
      requiredRole: selectedMode === "release" ? ("buyer" as const) : ("seller" as const),
    },
  };
}

function normalizedSafeJson(value: string): string {
  return kaspa.Transaction.deserializeFromSafeJSON(value).serializeToSafeJSON();
}

/**
 * Accept only the one signature-slot replacement reviewed by the browser.
 * Every output, fee, lock time, outpoint and covenant byte is rebuilt here.
 */
export function validateSignedEscrowCanaryTransaction(input: {
  mode: EscrowCanaryMode;
  row: EscrowV1StoredRecord;
  transactionSafeJson: string;
  utxo: PrototypeUtxo;
}) {
  const prepared = prepareEscrowCanaryTransaction(input.row, input.mode, input.utxo);
  assertEscrowV1SigningIntent(prepared.transactionSafeJson, input.transactionSafeJson);

  const expected = JSON.parse(normalizedSafeJson(prepared.transactionSafeJson)) as {
    inputs: Array<{ signatureScript: string }>;
  };
  const actualJson = normalizedSafeJson(input.transactionSafeJson);
  const actual = JSON.parse(actualJson) as {
    id: string;
    inputs: Array<{ signatureScript: string }>;
  };
  const expectedWitness = expected.inputs[0]?.signatureScript ?? "";
  const actualWitness = actual.inputs[0]?.signatureScript ?? "";
  const signaturePush = actualWitness.slice(0, 132);
  if (
    !/^41[0-9a-f]{128}01$/u.test(signaturePush) ||
    signaturePush === `41${"00".repeat(64)}01` ||
    actualWitness.slice(132) !== expectedWitness.slice(132)
  ) {
    throw new Error("Signed escrow witness differs from the reviewed covenant.");
  }

  const signature = signaturePush.slice(2);
  const canonicalSigned = buildEscrowV1Transaction(
    buildEscrowCanarySpend(input.row, input.mode, input.utxo),
    [signature],
  ).transactionSafeJson;
  if (normalizedSafeJson(canonicalSigned) !== actualJson) {
    throw new Error("Signed escrow transaction is not canonical.");
  }
  if (!/^[0-9a-f]{64}$/u.test(actual.id)) {
    throw new Error("Signed escrow transaction ID is invalid.");
  }
  return { transactionId: actual.id, transactionSafeJson: actualJson };
}

export function escrowCanarySubmittedTransaction(
  row: Pick<EscrowV1StoredRecord, "claimTxId" | "refundTxId" | "releaseTxId">,
) {
  if (row.releaseTxId) return { mode: "release" as const, transactionId: row.releaseTxId };
  if (row.refundTxId) return { mode: "refund" as const, transactionId: row.refundTxId };
  if (row.claimTxId) return { mode: "claim" as const, transactionId: row.claimTxId };
  return null;
}
