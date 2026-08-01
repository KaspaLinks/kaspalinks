import { describe, expect, it } from "vitest";

import {
  createGiveawayPrizeRecoveryBundle,
  parseGiveawayPrizeRecoveryBundle,
} from "./giveaway-prize-recovery";
import { createToccataLabKeyPair } from "./toccata-lab-keys";

describe("giveaway prize recovery", () => {
  it("round-trips both browser-only spend paths", () => {
    const claim = createToccataLabKeyPair();
    const refund = createToccataLabKeyPair();
    const createdAt = "2026-07-21T08:00:00.000Z";
    const bundle = createGiveawayPrizeRecoveryBundle({
      amountKas: "10.002",
      amountSompi: "1000200000",
      claimCode: claim.privateKey,
      claimPublicKey: claim.xOnlyPublicKey,
      createdAt,
      createdAtMs: Date.parse(createdAt),
      description: "Giveaway prize",
      feeKas: "0.002",
      feeSompi: "200000",
      fundingAddress: `kaspa:${"q".repeat(61)}`,
      linkKey: "giveaway-prize-test",
      netClaimKas: "10",
      redeemScriptHex: "aa",
      refundCode: refund.privateKey,
      refundLockTime: "123456",
      refundPublicKey: refund.xOnlyPublicKey,
      title: "Test giveaway",
    });

    expect(parseGiveawayPrizeRecoveryBundle(JSON.stringify(bundle))).toEqual(bundle);
    expect(JSON.stringify(bundle)).toContain(claim.privateKey);
    expect(JSON.stringify(bundle)).toContain(refund.privateKey);
  });

  it("rejects a mismatched private claim key", () => {
    const claim = createToccataLabKeyPair();
    const otherClaim = createToccataLabKeyPair();
    const refund = createToccataLabKeyPair();
    expect(() =>
      createGiveawayPrizeRecoveryBundle({
        amountKas: "1.002",
        amountSompi: "100200000",
        claimCode: otherClaim.privateKey,
        claimPublicKey: claim.xOnlyPublicKey,
        createdAt: "2026-07-21T08:00:00.000Z",
        createdAtMs: Date.parse("2026-07-21T08:00:00.000Z"),
        description: "Prize",
        feeKas: "0.002",
        feeSompi: "200000",
        fundingAddress: `kaspa:${"q".repeat(61)}`,
        linkKey: "giveaway-prize-test",
        netClaimKas: "1",
        redeemScriptHex: "aa",
        refundCode: refund.privateKey,
        refundLockTime: "123456",
        refundPublicKey: refund.xOnlyPublicKey,
        title: "Test",
      }),
    ).toThrow(/claim key/);
  });
});
