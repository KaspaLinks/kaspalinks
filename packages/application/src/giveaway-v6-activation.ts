import { buildToccataKeylessCovenantSpend } from "@kaspa-actions/kaspa";
import {
  GIVEAWAY_V6_PRIZE_DISPATCH_TAGS,
  decodeGiveawayV6Witness,
  splitGiveawayV6ShardTemplateHex,
} from "@kaspa-actions/kaspa-indexer";

import {
  restoreGiveawayV6BootstrapBinding,
  type GiveawayV6ActivationOutput,
  type GiveawayV6BoundBootstrapRecord,
} from "./giveaway-v6-bootstrap.ts";

const ZERO_HASH = "00".repeat(32);

/** Exact SilverScript engine budget measured against the pinned V6 compiler output. */
export const GIVEAWAY_V6_ACTIVATION_COMPUTE_BUDGET = 147;

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

function requireBound<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Bound Giveaway V6 bootstrap is missing ${label}.`);
  return value;
}
