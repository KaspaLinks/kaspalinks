import { buildToccataClaimableReturnSpend } from "@kaspa-actions/kaspa";

import type { ReturnableClaimableLink } from "./claimable-return";
import { TOCCATA_CANARY_MIN_OUTPUT_SOMPI } from "./toccata-lab-fee";

// The return of a funded v2 link, prepared in advance. It needs no key and holds
// no secret: the script fixes its destination and fee, and Kaspa rejects it until
// the lock time. Anyone can broadcast it later with any Kaspa node, so the KAS
// comes back even if Kaspa Links is gone (tools/claimable-return/).

export const CLAIMABLE_RETURN_FILE_FORMAT = "kaspa-links/claimable-return@1";

export type ClaimableReturnFile = {
  amountSompi: string;
  expectedTransactionId: string;
  feeSompi: string;
  format: typeof CLAIMABLE_RETURN_FILE_FORMAT;
  fundingAddress: string;
  fundingOutpoint: { index: number; transactionId: string };
  howTo: string;
  linkKey: string;
  network: "mainnet";
  redeemScriptHex: string;
  returnAddress: string;
  /** Kaspa rejects the transaction until the virtual DAA score reaches this value. */
  returnAfterDaaScore: string;
  returnSompi: string;
  transactionSafeJson: string;
};

export type ClaimableReturnFileLink = Pick<
  ReturnableClaimableLink,
  | "amountSompi"
  | "feeSompi"
  | "fundingAddress"
  | "fundingOutputIndex"
  | "fundingTxId"
  | "redeemScriptHex"
  | "refundLockTime"
  | "returnAddress"
  | "scriptVersion"
> & { linkKey: string };

/** Null until the link is a funded v2 link whose funding output is known. */
export function buildClaimableReturnFile(
  link: ClaimableReturnFileLink,
): ClaimableReturnFile | null {
  if (
    link.scriptVersion !== 2 ||
    !link.returnAddress ||
    !link.fundingTxId ||
    link.fundingOutputIndex === null
  ) {
    return null;
  }
  if (link.amountSompi - link.feeSompi < TOCCATA_CANARY_MIN_OUTPUT_SOMPI) return null;

  const spend = buildToccataClaimableReturnSpend({
    expectedFundingAddress: link.fundingAddress,
    feeSompi: link.feeSompi,
    fundingAmountSompi: link.amountSompi,
    fundingOutputIndex: link.fundingOutputIndex,
    fundingTransactionId: link.fundingTxId,
    redeemScriptHex: link.redeemScriptHex,
    refundLockTime: link.refundLockTime,
    returnAddress: link.returnAddress,
  });

  return {
    amountSompi: link.amountSompi.toString(),
    expectedTransactionId: spend.transactionId,
    feeSompi: link.feeSompi.toString(),
    format: CLAIMABLE_RETURN_FILE_FORMAT,
    fundingAddress: link.fundingAddress,
    fundingOutpoint: { index: link.fundingOutputIndex, transactionId: link.fundingTxId },
    howTo:
      "Only needed if Kaspa Links is unavailable after the claim window. Send it with tools/claimable-return/send-return.mjs from github.com/KaspaLinks/kaspalinks, see docs/claimable-return-without-kaspa-links.md.",
    linkKey: link.linkKey,
    network: "mainnet",
    redeemScriptHex: link.redeemScriptHex,
    returnAddress: link.returnAddress,
    returnAfterDaaScore: link.refundLockTime,
    returnSompi: (link.amountSompi - link.feeSompi).toString(),
    transactionSafeJson: spend.transactionSafeJson,
  };
}
