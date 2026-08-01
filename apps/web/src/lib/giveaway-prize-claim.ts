import { buildKaspaAddressScriptPublicKeyHex } from "@kaspa-actions/kaspa";

import {
  readClaimableBroadcastSafeJsonSummary,
  readClaimableSpendMode,
  validateRegisteredClaimableMetadata,
} from "./toccata-lab";

export type GiveawayPrizeClaimLink = {
  amountSompi: bigint;
  feeSompi: bigint;
  fundingOutputIndex: null | number;
  fundingTxId: null | string;
  redeemScriptHex: string;
  refundLockTime: string;
  status: string;
  claimPublicKey: string;
  fundingAddress: string;
  refundPublicKey: string;
};

export function verifyPreparedGiveawayPrizeClaim(input: {
  expectedTransactionId: string;
  link: GiveawayPrizeClaimLink;
  transactionSafeJson: string;
  winnerAddress: string;
}) {
  const summary = readClaimableBroadcastSafeJsonSummary(input.transactionSafeJson);
  if (summary.transactionId !== input.expectedTransactionId.toLowerCase()) {
    throw new Error("Prepared prize transaction id does not match its signed JSON.");
  }

  const canonicalLink = validateRegisteredClaimableMetadata(
    {
      amountSompi: input.link.amountSompi.toString(),
      claimPublicKey: input.link.claimPublicKey,
      feeSompi: input.link.feeSompi.toString(),
      fundingAddress: input.link.fundingAddress,
      redeemScriptHex: input.link.redeemScriptHex,
      refundLockTime: input.link.refundLockTime,
      refundPublicKey: input.link.refundPublicKey,
    },
    { allowLegacyAmount: true },
  );

  if (
    readClaimableSpendMode(summary.signatureScriptHex, canonicalLink.redeemScriptHex) !== "claim"
  ) {
    throw new Error("Prepared prize transaction must use the claim branch.");
  }
  if (!input.link.fundingTxId || input.link.fundingOutputIndex === null) {
    throw new Error("Prize funding output is not confirmed.");
  }
  if (
    summary.fundingTransactionId !== input.link.fundingTxId.toLowerCase() ||
    summary.fundingOutputIndex !== input.link.fundingOutputIndex
  ) {
    throw new Error("Prepared prize transaction does not spend the registered prize output.");
  }
  if (summary.fundingAmountSompi !== canonicalLink.amountSompi.toString()) {
    throw new Error("Prepared prize transaction has the wrong funding amount.");
  }
  if (
    summary.outputAmountSompi !== (canonicalLink.amountSompi - canonicalLink.feeSompi).toString()
  ) {
    throw new Error("Prepared prize transaction has the wrong payout amount.");
  }
  if (summary.lockTime !== "0") {
    throw new Error("Prepared prize claim must not set a transaction lock time.");
  }

  const expectedOutputScript = buildKaspaAddressScriptPublicKeyHex(input.winnerAddress);
  if (summary.outputScriptPublicKeyHex !== expectedOutputScript) {
    throw new Error("Prepared prize transaction is not locked to the selected winner address.");
  }

  return summary;
}
