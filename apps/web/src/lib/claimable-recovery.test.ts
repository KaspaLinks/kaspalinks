import { describe, expect, it } from "vitest";

import { createToccataLabKeyPair } from "./toccata-lab-keys";

import {
  assertClaimableMatchesRecoveryTarget,
  buildClaimableRecoveryPath,
  createClaimableRecoveryBundle,
  parseClaimableRecoveryBundle,
  readClaimableRecoveryTarget,
  type ClaimableRecoveryRecord,
} from "./claimable-recovery";

function createRecord(): ClaimableRecoveryRecord {
  const claimKey = createToccataLabKeyPair();
  const refundKey = createToccataLabKeyPair();
  const createdAt = "2026-07-20T10:00:00.000Z";
  return {
    amountKas: "1.002",
    amountSompi: "100200000",
    claimPublicKey: claimKey.xOnlyPublicKey,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    description: "A private recovery test",
    feeKas: "0.002",
    feeSompi: "200000",
    fundingAddress: `kaspa:${"q".repeat(61)}`,
    fundingMatch: null,
    id: "lab-recovery-test",
    netClaimKas: "1",
    redeemScriptHex: "aa20",
    refundCode: refundKey.privateKey,
    refundLockTime: "500000000",
    refundPublicKey: refundKey.xOnlyPublicKey,
    status: "awaiting_funding",
    title: "Recovery test",
    validFor: "24 hours",
  };
}

describe("single claimable recovery bundles", () => {
  it("round-trips refund recovery without exporting the claim key", () => {
    const record = createRecord();
    const bundle = createClaimableRecoveryBundle(record, "2026-07-20T10:01:00.000Z");
    const serialized = JSON.stringify(bundle);
    const parsed = parseClaimableRecoveryBundle(serialized);

    expect(parsed.link).toEqual(record);
    expect(serialized).not.toContain("claimCode");
    expect(parsed.format).toBe("kaspalinks-claimable-link-recovery");
  });

  it("rejects a refund key that does not match the public contract", () => {
    const bundle = createClaimableRecoveryBundle(createRecord());
    bundle.link.refundCode = createToccataLabKeyPair().privateKey;

    expect(() => parseClaimableRecoveryBundle(JSON.stringify(bundle))).toThrow(
      "Recovery file refund key does not match its public key.",
    );
  });

  it("rejects display amounts that do not match the sompi contract values", () => {
    const bundle = createClaimableRecoveryBundle(createRecord());
    bundle.link.netClaimKas = "2";

    expect(() => parseClaimableRecoveryBundle(JSON.stringify(bundle))).toThrow(
      "Recovery file KAS amounts do not match its contract values.",
    );
  });

  it("builds and verifies a recovery target from My Links", () => {
    const path = buildClaimableRecoveryPath("lab-recovery-test", "Recovery test");
    const target = readClaimableRecoveryTarget(path.slice(path.indexOf("?")));

    expect(target).toEqual({ linkKey: "lab-recovery-test", title: "Recovery test" });
    expect(() => assertClaimableMatchesRecoveryTarget(createRecord(), target)).not.toThrow();
    expect(() =>
      assertClaimableMatchesRecoveryTarget({ id: "lab-other", title: "Another link" }, target),
    ).toThrow("not the claimable link selected in My Links");
  });
});
