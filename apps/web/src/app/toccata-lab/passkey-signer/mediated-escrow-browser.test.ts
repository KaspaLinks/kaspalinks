import { createRequire } from "node:module";

import { ESCROW_V2_TEMPLATE_HASH } from "@kaspa-actions/kaspa";
import { describe, expect, it } from "vitest";

import {
  deriveEscrowSignerPublicIdentity,
  type EscrowSignerContext,
} from "@/lib/escrow-passkey-signer";
import {
  createMediatedEscrowTerms,
  MEDIATED_ESCROW_AMOUNT_SOMPI,
  MEDIATED_ESCROW_FALLBACK_DAA,
  MEDIATED_ESCROW_FEE_SOMPI,
  MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
  prepareMediatedEscrowTransaction,
  validateMediatedEscrowSignatures,
  type MediatedEscrowStoredRecord,
} from "@/lib/mediated-escrow-v2";
import { signPreparedMediatedEscrow } from "./mediated-escrow-browser";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const escrowId = "mediated-browser-test";
const context = (role: "buyer" | "mediator" | "seller"): EscrowSignerContext => ({
  escrowId,
  network: "mainnet",
  role,
  signerVersion: 1,
});
const buyerPrf = new Uint8Array(32).fill(7);
const sellerPrf = new Uint8Array(32).fill(8);
const mediatorPrf = new Uint8Array(32).fill(9);
const buyerAddress = new sdk.PrivateKey("31".repeat(32))
  .toPublicKey()
  .toAddress("mainnet")
  .toString();
const sellerAddress = new sdk.PrivateKey("32".repeat(32))
  .toPublicKey()
  .toAddress("mainnet")
  .toString();

async function fixture() {
  const [buyer, seller, mediator] = await Promise.all([
    deriveEscrowSignerPublicIdentity(buyerPrf, context("buyer")),
    deriveEscrowSignerPublicIdentity(sellerPrf, context("seller")),
    deriveEscrowSignerPublicIdentity(mediatorPrf, context("mediator")),
  ]);
  const terms = createMediatedEscrowTerms({
    buyerAddress,
    buyerPublicKey: buyer.publicKey,
    claimDelayDaa: 6_048_000n,
    mediatorPublicKey: mediator.publicKey,
    sellerAddress,
    sellerPublicKey: seller.publicKey,
  });
  const row: MediatedEscrowStoredRecord = {
    activeFundingAddress: terms.active.address,
    agreementTxId: null,
    amountSompi: MEDIATED_ESCROW_AMOUNT_SOMPI,
    arbitrationTxId: null,
    buyerAddress,
    buyerPublicKey: buyer.publicKey,
    claimDelayDaa: 6_048_000n,
    claimTxId: null,
    contractTemplateHash: ESCROW_V2_TEMPLATE_HASH,
    fallbackDelayDaa: MEDIATED_ESCROW_FALLBACK_DAA,
    fallbackTxId: null,
    feeSompi: MEDIATED_ESCROW_FEE_SOMPI,
    freezeTxId: null,
    frozenFundingAddress: terms.frozen.address,
    mediatorPublicKey: mediator.publicKey,
    refundTxId: null,
    releaseTxId: null,
    sellerAddress,
    sellerPublicKey: seller.publicKey,
  };
  const utxo = {
    amount: MEDIATED_ESCROW_AMOUNT_SOMPI.toString(),
    blockDaaScore: "600000001",
    index: 0,
    transactionId: "ab".repeat(32),
  };
  return { buyer, mediator, row, utxo };
}

describe("mediated escrow browser signing", () => {
  it("lets the mediator and winning buyer fill only their own slots", async () => {
    const { buyer, mediator, row, utxo } = await fixture();
    const prepared = prepareMediatedEscrowTransaction({
      buyerShareSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
      mediatorParty: "buyer",
      mode: "arbitrate",
      row,
      utxo,
    });
    const mediatorSigned = await signPreparedMediatedEscrow({
      context: context("mediator"),
      expectedPublicKey: mediator.publicKey,
      prepared,
      prfOutput: mediatorPrf,
      role: "mediator",
      sdk,
    });
    expect(mediatorSigned.complete).toBe(false);
    expect(
      validateMediatedEscrowSignatures({
        buyerShareSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
        complete: false,
        mediatorParty: "buyer",
        mode: "arbitrate",
        row,
        transactionSafeJson: mediatorSigned.transactionSafeJson,
        utxo,
      }).filled,
    ).toEqual([false, true]);

    const buyerSigned = await signPreparedMediatedEscrow({
      context: context("buyer"),
      expectedPublicKey: buyer.publicKey,
      prepared: { ...prepared, transactionSafeJson: mediatorSigned.transactionSafeJson },
      prfOutput: buyerPrf,
      role: "buyer",
      sdk,
    });
    expect(buyerSigned.complete).toBe(true);
    expect(
      validateMediatedEscrowSignatures({
        buyerShareSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
        complete: true,
        mediatorParty: "buyer",
        mode: "arbitrate",
        row,
        transactionSafeJson: buyerSigned.transactionSafeJson,
        utxo,
      }).transactionId,
    ).toBe(buyerSigned.transactionId);
  });

  it("rejects a wrong passkey role and changed payout before signing", async () => {
    const { buyer, row, utxo } = await fixture();
    const prepared = prepareMediatedEscrowTransaction({
      mode: "fallbackSeller",
      row,
      utxo,
    });
    await expect(
      signPreparedMediatedEscrow({
        context: context("buyer"),
        expectedPublicKey: buyer.publicKey,
        prepared,
        prfOutput: buyerPrf,
        role: "buyer",
        sdk,
      }),
    ).rejects.toThrow(/cannot sign/u);

    const changed = JSON.parse(prepared.transactionSafeJson);
    changed.outputs[0].value = "1";
    await expect(
      signPreparedMediatedEscrow({
        context: context("seller"),
        expectedPublicKey: row.sellerPublicKey,
        prepared: { ...prepared, transactionSafeJson: JSON.stringify(changed) },
        prfOutput: sellerPrf,
        role: "seller",
        sdk,
      }),
    ).rejects.toThrow(/differs/u);
  });
});
