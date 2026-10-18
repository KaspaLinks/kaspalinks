import { buildToccataKeylessCovenantSpend } from "@kaspa-actions/kaspa";
import {
  GIVEAWAY_V6_SHARD_DISPATCH_TAGS,
  buildGiveawayV6ShardRedeemScriptHex,
  decodeGiveawayV6Witness,
  giveawayV6PayToScriptHashScriptPublicKeyHex,
  giveawayV6TemplateHashHex,
  prepareGiveawayV6RegistrationProof,
  type GiveawayV6FamilyDescriptor,
  type GiveawayV6ReconstructionConfig,
  type GiveawayV6ReconstructionSnapshot,
  GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET,
} from "@kaspa-actions/kaspa-indexer";

export { GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET };

export type GiveawayV6RegistrationTransaction = {
  commitmentHex: string;
  computeBudget: number;
  computeMass: string;
  feeMass: string;
  feeSompi: string;
  fundingAmountSompi: string;
  fundingOutputIndex: number;
  fundingTransactionId: string;
  mass: string;
  minimumFeeSompi: string;
  outputAmountSompi: string;
  shardIndex: number;
  signatureScriptHex: string;
  storageMass: string;
  transactionId: string;
  transactionSafeJson: string;
  transientMass: string;
};

/**
 * Builds and intent-checks one keyless public registration. The only value
 * leaving the shard is the fixed protocol fee; the successor remains bound to
 * the same covenant family and to the participant's payout commitment.
 */
export function buildGiveawayV6RegistrationTransaction(input: {
  config: GiveawayV6ReconstructionConfig;
  family: GiveawayV6FamilyDescriptor;
  activationBlockDaaScore: bigint;
  payoutScriptPublicKeyHex: string;
  shardTemplateRedeemScriptHex: string;
  snapshot: GiveawayV6ReconstructionSnapshot;
}): GiveawayV6RegistrationTransaction {
  if (
    giveawayV6TemplateHashHex("shard", input.shardTemplateRedeemScriptHex) !==
    input.family.shardTemplateHashHex
  ) {
    throw new Error("Giveaway V6 shard template disagrees with the covenant family.");
  }
  const proof = prepareGiveawayV6RegistrationProof(
    input.config,
    input.snapshot,
    input.payoutScriptPublicKeyHex,
  );
  const shard = input.snapshot.shards[proof.shardIndex]!;
  const inputBlockDaaScore =
    shard.pendingEntry?.registeredAtDaa ?? input.activationBlockDaaScore;
  const registrationsInShard =
    shard.finalizedEntryCount + (shard.pendingEntry === null ? 0 : 1);
  const fundingAmountSompi =
    input.family.shardValueSompi -
    BigInt(registrationsInShard) * input.family.entryFeeSompi;
  const outputAmountSompi = fundingAmountSompi - input.family.entryFeeSompi;
  if (outputAmountSompi <= 0n) {
    throw new Error("Giveaway V6 shard reserve cannot cover another registration.");
  }

  const currentRedeemScriptHex = buildGiveawayV6ShardRedeemScriptHex(
    input.shardTemplateRedeemScriptHex,
    proof.currentState,
  );
  const nextRedeemScriptHex = buildGiveawayV6ShardRedeemScriptHex(
    input.shardTemplateRedeemScriptHex,
    proof.nextState,
  );
  const transaction = buildToccataKeylessCovenantSpend({
    computeBudget: GIVEAWAY_V6_REGISTRATION_COMPUTE_BUDGET,
    feeSompi: input.family.entryFeeSompi,
    funding: {
      amountSompi: fundingAmountSompi,
      blockDaaScore: inputBlockDaaScore,
      outputIndex: proof.tipOutpoint.outputIndex,
      scriptPublicKeyHex:
        giveawayV6PayToScriptHashScriptPublicKeyHex(currentRedeemScriptHex),
      transactionId: proof.tipOutpoint.transactionId,
    },
    invocationStackHex: [
      input.payoutScriptPublicKeyHex,
      proof.appendSiblingsHex.join(""),
      proof.addressSiblingsHex.join(""),
      GIVEAWAY_V6_SHARD_DISPATCH_TAGS.register,
    ],
    outputs: [
      {
        amountSompi: outputAmountSompi,
        covenant: { authorizingInput: 0, covenantIdHex: input.family.covenantIdHex },
        scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(nextRedeemScriptHex),
      },
    ],
    redeemScriptHex: currentRedeemScriptHex,
  });

  const witness = decodeGiveawayV6Witness(transaction.signatureScriptHex);
  if (
    witness.contract !== "shard" ||
    witness.method !== "register" ||
    witness.redeemScriptHex !== currentRedeemScriptHex ||
    witness.templateHashHex !== input.family.shardTemplateHashHex ||
    witness.payoutScriptPublicKeyHex !== input.payoutScriptPublicKeyHex.toLowerCase() ||
    witness.appendSiblingCount !== input.config.treeDepth ||
    witness.addressSiblingCount !== 256 ||
    JSON.stringify(witness.state) !== JSON.stringify(proof.currentState)
  ) {
    throw new Error("Giveaway V6 registration witness disagrees with the reconstructed state.");
  }

  return {
    commitmentHex: proof.commitmentHex,
    computeBudget: transaction.computeBudget,
    computeMass: transaction.computeMass,
    feeMass: transaction.feeMass,
    feeSompi: transaction.feeSompi,
    fundingAmountSompi: transaction.fundingAmountSompi,
    fundingOutputIndex: transaction.fundingOutputIndex,
    fundingTransactionId: transaction.fundingTransactionId,
    mass: transaction.mass,
    minimumFeeSompi: transaction.minimumFeeSompi,
    outputAmountSompi: outputAmountSompi.toString(),
    shardIndex: proof.shardIndex,
    signatureScriptHex: transaction.signatureScriptHex,
    storageMass: transaction.storageMass,
    transactionId: transaction.transactionId,
    transactionSafeJson: transaction.transactionSafeJson,
    transientMass: transaction.transientMass,
  };
}
