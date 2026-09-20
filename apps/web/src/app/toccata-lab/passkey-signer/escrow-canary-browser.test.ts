import { createRequire } from "node:module";

import type { EscrowPrototype } from "@kaspa-actions/db";
import { describe, expect, it } from "vitest";

import {
  deriveEscrowSignerPublicIdentity,
  type EscrowSignerContext,
} from "@/lib/escrow-passkey-signer";
import {
  createEscrowCanaryTerms,
  prepareEscrowCanaryTransaction,
  validateSignedEscrowCanaryTransaction,
} from "@/lib/escrow-canary";
import { signPreparedEscrowCanary } from "./escrow-canary-browser";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const signerContextId = "canary-browser-test";
const buyerContext: EscrowSignerContext = {
  escrowId: signerContextId,
  network: "mainnet",
  role: "buyer",
  signerVersion: 1,
};
const sellerContext: EscrowSignerContext = { ...buyerContext, role: "seller" };
const buyerPrf = new Uint8Array(32).fill(7);
const sellerPrf = new Uint8Array(32).fill(8);
const payout = new sdk.PrivateKey("23".repeat(32)).toPublicKey().toAddress("mainnet").toString();
const utxo = {
  amount: "22000000",
  blockDaaScore: "600000001",
  index: 0,
  transactionId: "ab".repeat(32),
};

async function fixture() {
  const [buyer, seller] = await Promise.all([
    deriveEscrowSignerPublicIdentity(buyerPrf, buyerContext),
    deriveEscrowSignerPublicIdentity(sellerPrf, sellerContext),
  ]);
  const terms = createEscrowCanaryTerms({
    buyerPublicKey: buyer.publicKey,
    chainDaa: 600_000_000n,
    payoutAddress: payout,
    sellerPublicKey: seller.publicKey,
  });
  const row: EscrowPrototype = {
    id: "cm12345678901234567890123",
    creatorId: "creator",
    signerContextId,
    amountSompi: terms.parameters.amount,
    feeSompi: terms.parameters.fee,
    releaseAfter: terms.parameters.releaseAfter,
    buyerPublicKey: buyer.publicKey,
    sellerPublicKey: seller.publicKey,
    buyerAddress: payout,
    sellerAddress: payout,
    activeFundingAddress: terms.active.address,
    frozenFundingAddress: terms.frozen.address,
    status: "awaiting_funding",
    releaseTxId: null,
    refundTxId: null,
    claimTxId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  return { buyer, row };
}

describe("browser passkey canary signing", () => {
  it("signs only the empty witness slot and passes server reconstruction", async () => {
    const { buyer, row } = await fixture();
    const prepared = prepareEscrowCanaryTransaction(row, "release", utxo);
    const signed = await signPreparedEscrowCanary({
      context: buyerContext,
      expectedPublicKey: buyer.publicKey,
      prepared,
      prfOutput: buyerPrf,
      sdk,
    });
    expect(signed.transactionId).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      validateSignedEscrowCanaryTransaction({
        mode: "release",
        row,
        transactionSafeJson: signed.transactionSafeJson,
        utxo,
      }),
    ).toMatchObject({ transactionId: signed.transactionId });
  });

  it("rejects the wrong passkey and a changed destination before signing", async () => {
    const { row } = await fixture();
    const prepared = prepareEscrowCanaryTransaction(row, "release", utxo);
    await expect(
      signPreparedEscrowCanary({
        context: buyerContext,
        expectedPublicKey: row.sellerPublicKey,
        prepared,
        prfOutput: buyerPrf,
        sdk,
      }),
    ).rejects.toThrow(/does not match/u);

    const changed = JSON.parse(prepared.transactionSafeJson);
    changed.outputs[0].value = "1";
    await expect(
      signPreparedEscrowCanary({
        context: buyerContext,
        expectedPublicKey: row.buyerPublicKey,
        prepared: { ...prepared, transactionSafeJson: JSON.stringify(changed) },
        prfOutput: buyerPrf,
        sdk,
      }),
    ).rejects.toThrow(/differs/u);
  });
});
