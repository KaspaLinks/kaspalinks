import { buildToccataKeylessCovenantSpend } from "@kaspa-actions/kaspa";
import { GiveawayV6BootstrapStatus, type PrismaClient } from "@kaspa-actions/db";
import {
  GIVEAWAY_V6_PRIZE_DISPATCH_TAGS,
  decodeGiveawayV6Witness,
  splitGiveawayV6ShardTemplateHex,
  GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET,
} from "@kaspa-actions/kaspa-indexer";

import {
  restoreGiveawayV6BootstrapBinding,
  type GiveawayV6ActivationOutput,
  type GiveawayV6BoundBootstrapRecord,
} from "./giveaway-v6-bootstrap.ts";

export { GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET };

const ZERO_HASH = "00".repeat(32);

export type GiveawayV6ActivationTransaction = {
  activationOutputs: readonly GiveawayV6ActivationOutput[];
  computeMass: string;
  computeBudget: number;
  covenantIdHex: string;
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

export type GiveawayV6ActivationDeliveryRecord = {
  activationTransactionId: string | null;
  giveawayId: string;
  id: string;
  status: GiveawayV6BootstrapStatus;
};

export type GiveawayV6ActivationAttemptErrorCode =
  | "ACTIVATION_RELAY_REJECTED"
  | "ACTIVATION_RELAY_UNAVAILABLE";

/**
 * Builds and intent-checks the keyless genesis transition. It never signs,
 * stores wallet material, or broadcasts a transaction.
 */
export function buildGiveawayV6ActivationTransaction(
  record: GiveawayV6BoundBootstrapRecord,
): GiveawayV6ActivationTransaction {
  const prepared = restoreGiveawayV6BootstrapBinding(record);
  const shardPieces = splitGiveawayV6ShardTemplateHex(record.shardTemplateRedeemScriptHex);
  const transaction = buildToccataKeylessCovenantSpend({
    computeBudget: GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET,
    feeSompi: prepared.family.activationFeeSompi,
    funding: {
      amountSompi: record.expectedFundingSompi,
      blockDaaScore: requireBound(record.fundingBlockDaaScore, "funding block DAA score"),
      outputIndex: requireBound(record.fundingOutputIndex, "funding output index"),
      scriptPublicKeyHex: record.fundingScriptPublicKeyHex,
      transactionId: requireBound(record.fundingTransactionId, "funding transaction ID"),
    },
    invocationStackHex: [
      shardPieces.prefixHex,
      shardPieces.suffixHex,
      GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.activate,
    ],
    outputs: prepared.activationOutputs,
    redeemScriptHex: record.prizeRedeemScriptHex,
  });

  const witness = decodeGiveawayV6Witness(transaction.signatureScriptHex);
  if (
    witness.contract !== "prize" ||
    witness.method !== "activate" ||
    witness.redeemScriptHex !== record.prizeRedeemScriptHex ||
    witness.templateHashHex !== prepared.family.prizeTemplateHashHex ||
    witness.shardPrefixHex !== shardPieces.prefixHex ||
    witness.shardSuffixHex !== shardPieces.suffixHex ||
    witness.state.phase !== 0 ||
    witness.state.frozenRootHex !== ZERO_HASH ||
    witness.state.entryCount !== 0
  ) {
    throw new Error("Giveaway V6 activation witness disagrees with the reviewed bootstrap.");
  }

  return {
    activationOutputs: prepared.activationOutputs,
    computeMass: transaction.computeMass,
    computeBudget: transaction.computeBudget,
    covenantIdHex: prepared.family.covenantIdHex,
    feeMass: transaction.feeMass,
    feeSompi: transaction.feeSompi,
    fundingAmountSompi: transaction.fundingAmountSompi,
    fundingOutputIndex: transaction.fundingOutputIndex,
    fundingTransactionId: transaction.fundingTransactionId,
    mass: transaction.mass,
    minimumFeeSompi: transaction.minimumFeeSompi,
    signatureScriptHex: transaction.signatureScriptHex,
    storageMass: transaction.storageMass,
    transactionId: transaction.transactionId,
    transactionSafeJson: transaction.transactionSafeJson,
    transientMass: transaction.transientMass,
  };
}

/**
 * Persists the deterministic transaction ID before any relay call. A retry is
 * allowed only when it reconstructs the exact same public transaction.
 */
export async function persistGiveawayV6ActivationPlan(
  prisma: PrismaClient,
  record: GiveawayV6ActivationDeliveryRecord,
  transactionId: string,
): Promise<void> {
  const normalizedTransactionId = normalizeTransactionId(transactionId);
  assertDeliveryRecord(record, normalizedTransactionId);
  const updated = await prisma.giveawayV6Bootstrap.updateMany({
    data: { activationTransactionId: normalizedTransactionId },
    where: {
      giveawayId: record.giveawayId,
      id: record.id,
      OR: [{ activationTransactionId: null }, { activationTransactionId: normalizedTransactionId }],
      status: GiveawayV6BootstrapStatus.BOUND,
    },
  });
  if (updated.count !== 1) {
    throw new Error("Giveaway V6 activation plan changed during persistence.");
  }
}

/** Records a successful relay response without treating it as chain confirmation. */
export async function persistGiveawayV6ActivationSubmitted(
  prisma: PrismaClient,
  record: Pick<GiveawayV6ActivationDeliveryRecord, "giveawayId" | "id">,
  transactionId: string,
  attemptedAt: Date,
): Promise<void> {
  const normalizedTransactionId = normalizeTransactionId(transactionId);
  const updated = await prisma.giveawayV6Bootstrap.updateMany({
    data: {
      activationLastAttemptAt: attemptedAt,
      activationLastErrorCode: null,
      activationSubmittedAt: attemptedAt,
    },
    where: {
      activationTransactionId: normalizedTransactionId,
      giveawayId: record.giveawayId,
      id: record.id,
      status: GiveawayV6BootstrapStatus.BOUND,
    },
  });
  if (updated.count !== 1) {
    throw new Error("Giveaway V6 activation submission could not be persisted.");
  }
}

/** Stores only a bounded operational code; relay details never enter the database. */
export async function persistGiveawayV6ActivationFailure(
  prisma: PrismaClient,
  record: Pick<GiveawayV6ActivationDeliveryRecord, "giveawayId" | "id">,
  transactionId: string,
  attemptedAt: Date,
  errorCode: GiveawayV6ActivationAttemptErrorCode,
): Promise<void> {
  const normalizedTransactionId = normalizeTransactionId(transactionId);
  await prisma.giveawayV6Bootstrap.updateMany({
    data: {
      activationLastAttemptAt: attemptedAt,
      activationLastErrorCode: errorCode,
    },
    where: {
      activationSubmittedAt: null,
      activationTransactionId: normalizedTransactionId,
      giveawayId: record.giveawayId,
      id: record.id,
      status: GiveawayV6BootstrapStatus.BOUND,
    },
  });
}

function assertDeliveryRecord(
  record: GiveawayV6ActivationDeliveryRecord,
  transactionId: string,
): void {
  if (record.status !== GiveawayV6BootstrapStatus.BOUND) {
    throw new Error("Giveaway V6 funding must be bound before activation.");
  }
  if (
    record.activationTransactionId !== null &&
    normalizeTransactionId(record.activationTransactionId) !== transactionId
  ) {
    throw new Error("Stored Giveaway V6 activation transaction disagrees with reconstruction.");
  }
}

function normalizeTransactionId(value: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    throw new Error("Giveaway V6 activation transaction ID must be 32-byte hex.");
  }
  return normalized;
}

function requireBound<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Bound Giveaway V6 bootstrap is missing ${label}.`);
  return value;
}
