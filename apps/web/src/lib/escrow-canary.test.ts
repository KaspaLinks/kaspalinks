import { createRequire } from "node:module";

import type { EscrowPrototype } from "@kaspa-actions/db";
import { describe, expect, it } from "vitest";

import {
  createEscrowCanaryTerms,
  ESCROW_CANARY_FUNDING_SOMPI,
  prepareEscrowCanaryTransaction,
  selectEscrowCanaryUtxo,
} from "./escrow-canary";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const buyer = new sdk.PrivateKey("21".repeat(32));
const seller = new sdk.PrivateKey("22".repeat(32));
const payout = new sdk.PrivateKey("23".repeat(32)).toPublicKey().toAddress("mainnet").toString();

function canary(): EscrowPrototype {
  const terms = createEscrowCanaryTerms({
    buyerPublicKey: buyer.toPublicKey().toXOnlyPublicKey().toString(),
    chainDaa: 600_000_000n,
    payoutAddress: payout,
    sellerPublicKey: seller.toPublicKey().toXOnlyPublicKey().toString(),
  });
  return {
    id: "cm12345678901234567890123",
    creatorId: "creator",
    signerContextId: "canary-test-123",
    amountSompi: terms.parameters.amount,
    feeSompi: terms.parameters.fee,
    releaseAfter: terms.parameters.releaseAfter,
    buyerPublicKey: terms.parameters.buyerPublicKey,
    sellerPublicKey: terms.parameters.sellerPublicKey,
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
}

const exact = {
  amount: ESCROW_CANARY_FUNDING_SOMPI.toString(),
  blockDaaScore: "600000001",
  index: 2,
  transactionId: "ab".repeat(32),
};

describe("escrow mainnet canary", () => {
  it("commits a one-hour deadline and separate passkey signers", () => {
    const row = canary();
    expect(row.releaseAfter).toBe(600_036_000n);
    expect(row.buyerPublicKey).not.toBe(row.sellerPublicKey);
    expect(row.activeFundingAddress).toMatch(/^kaspa:/u);
    expect(row.activeFundingAddress).not.toBe(row.frozenFundingAddress);
  });

  it("selects one exact 0.22 KAS output while ignoring unrelated dust", () => {
    expect(selectEscrowCanaryUtxo([{ ...exact, amount: "1", index: 0 }, exact])).toEqual({
      state: "funded",
      utxo: exact,
    });
    expect(selectEscrowCanaryUtxo([exact, { ...exact, index: 3 }])).toEqual({
      state: "ambiguous",
      utxo: null,
    });
    expect(selectEscrowCanaryUtxo([])).toEqual({ state: "awaiting_funding", utxo: null });
  });

  for (const mode of ["release", "refund", "claim"] as const) {
    it(`prepares the canonical ${mode} spend`, () => {
      const prepared = prepareEscrowCanaryTransaction(canary(), mode, exact);
      const parsed = JSON.parse(prepared.transactionSafeJson);
      expect(parsed.inputs).toHaveLength(1);
      expect(parsed.inputs[0]).toMatchObject({
        computeBudget: 50,
        index: 2,
        transactionId: "ab".repeat(32),
      });
      expect(parsed.outputs).toHaveLength(1);
      expect(parsed.outputs[0].value).toBe("21000000");
      expect(parsed.lockTime).toBe(mode === "claim" ? "600036000" : "0");
      expect(prepared.review.requiredRole).toBe(mode === "release" ? "buyer" : "seller");
    });
  }
});
