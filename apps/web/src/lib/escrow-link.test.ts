import { describe, expect, it } from "vitest";

import {
  escrowLinkCreateSchema,
  escrowLinkFundingSompi,
  escrowLinkPublicActionSchema,
  joinedEscrowLinkRecord,
} from "./escrow-link";

const publicKey = "11".repeat(32);

describe("shared escrow links", () => {
  it("accepts only the offered deadline choices", () => {
    const base = {
      durationDaa: "36000",
      sellerAddress: `kaspa:${"q".repeat(61)}`,
      sellerPublicKey: publicKey,
      signerContextId: "escrow-context-123",
      title: "Design delivery",
    };
    expect(escrowLinkCreateSchema.safeParse(base).success).toBe(true);
    expect(escrowLinkCreateSchema.safeParse({ ...base, durationDaa: "1" }).success).toBe(false);
    expect(escrowLinkCreateSchema.safeParse({ ...base, privateKey: "never" }).success).toBe(false);
  });

  it("keeps join separate from spend actions", () => {
    expect(
      escrowLinkPublicActionSchema.safeParse({
        action: "join",
        buyerAddress: `kaspa:${"q".repeat(61)}`,
        buyerPublicKey: "22".repeat(32),
      }).success,
    ).toBe(true);
    expect(
      escrowLinkPublicActionSchema.safeParse({ action: "prepare", mode: "release", seed: "x" })
        .success,
    ).toBe(false);
  });

  it("refuses to construct a spend before the buyer commitment is complete", () => {
    const row = {
      activeFundingAddress: null,
      amountSompi: 21_000_000n,
      buyerAddress: null,
      buyerPublicKey: null,
      claimTxId: null,
      durationDaa: 36_000n,
      feeSompi: 1_000_000n,
      frozenFundingAddress: null,
      releaseAfter: null,
      refundTxId: null,
      releaseTxId: null,
      sellerAddress: `kaspa:${"q".repeat(61)}`,
      sellerPublicKey: publicKey,
    };
    expect(() => joinedEscrowLinkRecord(row as never)).toThrow(/buyer has not accepted/i);
    expect(escrowLinkFundingSompi(row)).toBe(22_000_000n);
  });
});
