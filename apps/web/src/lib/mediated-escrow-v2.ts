import { createRequire } from "node:module";

import type { MediatedEscrowPrototype } from "@kaspa-actions/db";
import {
  assertEscrowV2SigningIntent,
  buildEscrowV2Address,
  buildEscrowV2Transaction,
  buildKaspaAddressScriptPublicKeyHex,
  ESCROW_V2_EMPTY_SIGNATURE,
  ESCROW_V2_TEMPLATE_HASH,
  type EscrowV2Parameters,
  type EscrowV2Phase,
  type EscrowV2Spend,
} from "@kaspa-actions/kaspa";
import { z } from "zod";

import type { PrototypeUtxo } from "./giveaway-prize-v3-prototype";

const kaspa = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");

export const MEDIATED_ESCROW_AMOUNT_SOMPI = 21_000_000n;
export const MEDIATED_ESCROW_FEE_SOMPI = 1_000_000n;
export const MEDIATED_ESCROW_FUNDING_SOMPI =
  MEDIATED_ESCROW_AMOUNT_SOMPI + MEDIATED_ESCROW_FEE_SOMPI;
export const MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI =
  MEDIATED_ESCROW_AMOUNT_SOMPI - MEDIATED_ESCROW_FEE_SOMPI;
export const MEDIATED_ESCROW_COMPUTE_BUDGET = 50;
export const MEDIATED_ESCROW_FALLBACK_DAA = 25_920_000n;
export const MEDIATED_ESCROW_CLAIM_DELAYS_DAA = [6_048_000n, 12_096_000n, 25_920_000n] as const;

const xOnlyPublicKey = z.string().regex(/^[0-9a-f]{64}$/u);
const publicId = z.string().cuid();
const decimalSompi = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .max(20);

export const mediatedEscrowCreateSchema = z
  .object({
    claimDelayDaa: z
      .string()
      .max(10)
      .regex(/^\d+$/u)
      .refine((value) => MEDIATED_ESCROW_CLAIM_DELAYS_DAA.some((delay) => delay === BigInt(value))),
    mediatorLabel: z.string().trim().min(2).max(60),
    sellerAddress: z.string().trim().min(20).max(150),
    sellerPublicKey: xOnlyPublicKey,
    signerContextId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/u),
    title: z.string().trim().min(3).max(80),
  })
  .strict();

const preparedMode = z.enum([
  "agree",
  "arbitrate",
  "claim",
  "fallbackSeller",
  "freeze",
  "refund",
  "release",
]);

export const mediatedEscrowPublicIdSchema = publicId;
export const mediatedEscrowPublicActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("joinMediator"), mediatorPublicKey: xOnlyPublicKey }).strict(),
  z
    .object({
      action: z.literal("joinBuyer"),
      buyerAddress: z.string().trim().min(20).max(150),
      buyerPublicKey: xOnlyPublicKey,
    })
    .strict(),
  z
    .object({
      action: z.literal("prepare"),
      buyerShareSompi: decimalSompi.optional(),
      mediatorParty: z.enum(["buyer", "seller"]).optional(),
      mode: preparedMode,
    })
    .strict(),
  z
    .object({
      action: z.literal("saveSignature"),
      buyerShareSompi: decimalSompi.optional(),
      mediatorParty: z.enum(["buyer", "seller"]).optional(),
      mode: preparedMode,
      role: z.enum(["buyer", "mediator", "seller"]),
      transactionSafeJson: z.string().min(1).max(120_000),
    })
    .strict(),
  z.object({ action: z.literal("clearProposal") }).strict(),
]);

export type MediatedEscrowMode = z.infer<typeof preparedMode>;
export type MediatedEscrowRole = "buyer" | "mediator" | "seller";

export type MediatedEscrowStoredRecord = Pick<
  MediatedEscrowPrototype,
  | "activeFundingAddress"
  | "agreementTxId"
  | "amountSompi"
  | "arbitrationTxId"
  | "buyerAddress"
  | "buyerPublicKey"
  | "claimDelayDaa"
  | "claimTxId"
  | "contractTemplateHash"
  | "fallbackDelayDaa"
  | "fallbackTxId"
  | "feeSompi"
  | "freezeTxId"
  | "frozenFundingAddress"
  | "mediatorPublicKey"
  | "refundTxId"
  | "releaseTxId"
  | "sellerAddress"
  | "sellerPublicKey"
>;

export function assertMediatedEscrowConstants(
  row: Pick<
    MediatedEscrowStoredRecord,
    "amountSompi" | "claimDelayDaa" | "contractTemplateHash" | "fallbackDelayDaa" | "feeSompi"
  >,
) {
  if (
    row.amountSompi !== MEDIATED_ESCROW_AMOUNT_SOMPI ||
    row.feeSompi !== MEDIATED_ESCROW_FEE_SOMPI ||
    row.fallbackDelayDaa !== MEDIATED_ESCROW_FALLBACK_DAA ||
    row.contractTemplateHash !== ESCROW_V2_TEMPLATE_HASH ||
    !MEDIATED_ESCROW_CLAIM_DELAYS_DAA.some((delay) => delay === row.claimDelayDaa)
  ) {
    throw new Error("Stored mediated escrow terms do not match this release.");
  }
}

export function createMediatedEscrowTerms(input: {
  buyerAddress: string;
  buyerPublicKey: string;
  claimDelayDaa: bigint;
  mediatorPublicKey: string;
  sellerAddress: string;
  sellerPublicKey: string;
}) {
  if (!MEDIATED_ESCROW_CLAIM_DELAYS_DAA.some((delay) => delay === input.claimDelayDaa)) {
    throw new Error("Unsupported mediated escrow inspection delay.");
  }
  const parameters: EscrowV2Parameters = {
    amount: MEDIATED_ESCROW_AMOUNT_SOMPI,
    buyerPublicKey: input.buyerPublicKey,
    buyerScriptPublicKey: buildKaspaAddressScriptPublicKeyHex(input.buyerAddress),
    claimDelayDaa: input.claimDelayDaa,
    fallbackDelayDaa: MEDIATED_ESCROW_FALLBACK_DAA,
    fee: MEDIATED_ESCROW_FEE_SOMPI,
    mediatorPublicKey: input.mediatorPublicKey,
    sellerPublicKey: input.sellerPublicKey,
    sellerScriptPublicKey: buildKaspaAddressScriptPublicKeyHex(input.sellerAddress),
  };
  return {
    active: buildEscrowV2Address(parameters, "active"),
    frozen: buildEscrowV2Address(parameters, "frozen"),
    parameters,
  };
}

export function mediatedEscrowParameters(row: MediatedEscrowStoredRecord): EscrowV2Parameters {
  assertMediatedEscrowConstants(row);
  if (!row.buyerAddress || !row.buyerPublicKey || !row.mediatorPublicKey) {
    throw new Error("All three mediated escrow roles must join before funding.");
  }
  return createMediatedEscrowTerms({
    buyerAddress: row.buyerAddress,
    buyerPublicKey: row.buyerPublicKey,
    claimDelayDaa: row.claimDelayDaa,
    mediatorPublicKey: row.mediatorPublicKey,
    sellerAddress: row.sellerAddress,
    sellerPublicKey: row.sellerPublicKey,
  }).parameters;
}

export function selectMediatedEscrowUtxo(utxos: PrototypeUtxo[], expected: bigint) {
  const matches = utxos.filter((utxo) => BigInt(utxo.amount) === expected);
  if (matches.length === 0) return { state: "awaiting_funding" as const, utxo: null };
  if (matches.length > 1) return { state: "ambiguous" as const, utxo: null };
  return { state: "funded" as const, utxo: matches[0]! };
}

export function mediatedEscrowModePhase(mode: MediatedEscrowMode): EscrowV2Phase {
  return mode === "agree" || mode === "arbitrate" || mode === "fallbackSeller"
    ? "frozen"
    : "active";
}

export function mediatedEscrowRequiredRoles(
  mode: MediatedEscrowMode,
  mediatorParty?: "buyer" | "seller",
): MediatedEscrowRole[] {
  if (mode === "release" || mode === "freeze") return ["buyer"];
  if (mode === "refund" || mode === "claim" || mode === "fallbackSeller") return ["seller"];
  if (mode === "agree") return ["buyer", "seller"];
  if (mode === "arbitrate" && mediatorParty) return [mediatorParty, "mediator"];
  throw new Error("Mediator resolution requires the co-signing party.");
}

export function buildMediatedEscrowSpend(input: {
  buyerShareSompi?: bigint;
  mediatorParty?: "buyer" | "seller";
  mode: MediatedEscrowMode;
  phase?: EscrowV2Phase;
  row: MediatedEscrowStoredRecord;
  utxo: PrototypeUtxo;
}): EscrowV2Spend {
  const parameters = mediatedEscrowParameters(input.row);
  const phase = input.phase ?? mediatedEscrowModePhase(input.mode);
  if (phase !== mediatedEscrowModePhase(input.mode) && input.mode !== "refund") {
    throw new Error("Mediated escrow action is unavailable in this phase.");
  }
  const derived = buildEscrowV2Address(parameters, phase);
  const storedAddress =
    phase === "active" ? input.row.activeFundingAddress : input.row.frozenFundingAddress;
  if (!storedAddress || storedAddress !== derived.address) {
    throw new Error("Stored mediated escrow address no longer matches its commitment.");
  }
  return {
    parameters,
    phase,
    mode: input.mode,
    computeBudget: MEDIATED_ESCROW_COMPUTE_BUDGET,
    utxo: { ...input.utxo, scriptPublicKeyHex: derived.scriptPublicKeyHex },
    ...(input.buyerShareSompi !== undefined ? { buyerShare: input.buyerShareSompi } : {}),
    ...(input.mediatorParty !== undefined ? { mediatorParty: input.mediatorParty } : {}),
  };
}

function normalizedSafeJson(value: string): string {
  return kaspa.Transaction.deserializeFromSafeJSON(value).serializeToSafeJSON();
}

export function mediatedEscrowSignaturePushes(
  transactionSafeJson: string,
  count: number,
): string[] {
  const transaction = JSON.parse(normalizedSafeJson(transactionSafeJson)) as {
    inputs: Array<{ signatureScript: string }>;
  };
  const script = transaction.inputs[0]?.signatureScript ?? "";
  return Array.from({ length: count }, (_, index) => {
    const push = script.slice(index * 132, (index + 1) * 132);
    if (!/^41[0-9a-f]{128}01$/u.test(push)) {
      throw new Error("Signed mediated escrow witness has an invalid signature slot.");
    }
    return push;
  });
}

export function prepareMediatedEscrowTransaction(input: {
  buyerShareSompi?: bigint;
  mediatorParty?: "buyer" | "seller";
  mode: MediatedEscrowMode;
  phase?: EscrowV2Phase;
  row: MediatedEscrowStoredRecord;
  utxo: PrototypeUtxo;
}) {
  const spend = buildMediatedEscrowSpend(input);
  const roles = mediatedEscrowRequiredRoles(input.mode, input.mediatorParty);
  const prepared = buildEscrowV2Transaction(spend);
  const net =
    spend.phase === "active" ? spend.parameters.amount : MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI;
  const buyerShare = input.buyerShareSompi;
  const outputs =
    input.mode === "freeze"
      ? [
          {
            amountSompi: MEDIATED_ESCROW_AMOUNT_SOMPI.toString(),
            recipient: "frozen-contract" as const,
            recipientAddress: input.row.frozenFundingAddress!,
          },
        ]
      : input.mode === "refund"
        ? [
            {
              amountSompi: net.toString(),
              recipient: "buyer" as const,
              recipientAddress: input.row.buyerAddress!,
            },
          ]
        : input.mode === "agree" || input.mode === "arbitrate"
          ? [
              ...(buyerShare! > 0n
                ? [
                    {
                      amountSompi: buyerShare!.toString(),
                      recipient: "buyer" as const,
                      recipientAddress: input.row.buyerAddress!,
                    },
                  ]
                : []),
              ...(net - buyerShare! > 0n
                ? [
                    {
                      amountSompi: (net - buyerShare!).toString(),
                      recipient: "seller" as const,
                      recipientAddress: input.row.sellerAddress,
                    },
                  ]
                : []),
            ]
          : [
              {
                amountSompi: net.toString(),
                recipient: "seller" as const,
                recipientAddress: input.row.sellerAddress,
              },
            ];
  return {
    ...prepared,
    review: {
      buyerShareSompi: input.buyerShareSompi?.toString() ?? null,
      computeBudget: MEDIATED_ESCROW_COMPUTE_BUDGET,
      feeSompi: MEDIATED_ESCROW_FEE_SOMPI.toString(),
      fundingOutputIndex: input.utxo.index,
      fundingTransactionId: input.utxo.transactionId,
      mediatorParty: input.mediatorParty ?? null,
      mode: input.mode,
      netAmountSompi: net.toString(),
      outputs,
      phase: spend.phase,
      requiredRoles: roles,
      sequenceDelayDaa:
        input.mode === "claim"
          ? input.row.claimDelayDaa.toString()
          : input.mode === "fallbackSeller"
            ? input.row.fallbackDelayDaa.toString()
            : "0",
    },
  };
}

export function validateMediatedEscrowSignatures(input: {
  buyerShareSompi?: bigint;
  complete: boolean;
  mediatorParty?: "buyer" | "seller";
  mode: MediatedEscrowMode;
  phase?: EscrowV2Phase;
  row: MediatedEscrowStoredRecord;
  transactionSafeJson: string;
  utxo: PrototypeUtxo;
}) {
  const spend = buildMediatedEscrowSpend(input);
  const prepared = buildEscrowV2Transaction(spend);
  assertEscrowV2SigningIntent(prepared.transactionSafeJson, input.transactionSafeJson);
  const count = mediatedEscrowRequiredRoles(input.mode, input.mediatorParty).length;
  const pushes = mediatedEscrowSignaturePushes(input.transactionSafeJson, count);
  const signatures = pushes.map((push) => push.slice(2));
  const filled = signatures.map((signature) => signature !== ESCROW_V2_EMPTY_SIGNATURE);
  if (!filled.some(Boolean)) throw new Error("No mediated escrow signature was supplied.");
  if (input.complete && !filled.every(Boolean)) {
    throw new Error("All required mediated escrow signatures are needed before broadcast.");
  }
  const canonicalSigned = buildEscrowV2Transaction(spend, signatures).transactionSafeJson;
  const actualJson = normalizedSafeJson(input.transactionSafeJson);
  if (normalizedSafeJson(canonicalSigned) !== actualJson) {
    throw new Error("Signed mediated escrow transaction is not canonical.");
  }
  const parsed = JSON.parse(actualJson) as { id: string };
  if (!/^[0-9a-f]{64}$/u.test(parsed.id)) throw new Error("Signed transaction ID is invalid.");
  return { filled, transactionId: parsed.id, transactionSafeJson: actualJson };
}

export function mediatedEscrowSubmittedTransaction(row: MediatedEscrowStoredRecord) {
  const candidates: Array<[MediatedEscrowMode, string | null]> = [
    ["release", row.releaseTxId],
    ["refund", row.refundTxId],
    ["claim", row.claimTxId],
    ["agree", row.agreementTxId],
    ["arbitrate", row.arbitrationTxId],
    ["fallbackSeller", row.fallbackTxId],
    ["freeze", row.freezeTxId],
  ];
  const found = candidates.find(([, transactionId]) => transactionId);
  return found ? { mode: found[0], transactionId: found[1]! } : null;
}
