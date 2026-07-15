import { describe, expect, it } from "vitest";

import {
  createBatchRecoveryBundle,
  parseBatchRecoveryBundle,
  type BatchRecoveryRecord,
} from "./batch-claimable-recovery";
import { deriveToccataLabKeyPair } from "./toccata-lab-keys";

const activationCode = "1".padStart(64, "0");
const refundCode = "2".padStart(64, "0");

function record(): BatchRecoveryRecord {
  const createdAt = "2026-07-12T10:00:00.000Z";
  const link = (index: number) => {
    const claimCode = String(index + 2).padStart(64, "0");
    const childRefundCode = String(index + 10).padStart(64, "0");
    return {
      amountKas: "1",
      amountSompi: "100000000",
      claimCode,
      claimPublicKey: deriveToccataLabKeyPair(claimCode).xOnlyPublicKey,
      description: "Test",
      feeKas: "0.002",
      feeSompi: "200000",
      fundingAddress: `kaspa:${"q".repeat(61)}`,
      fundingMatch: null,
      id: `batch-test-${index}`,
      netClaimKas: "0.998",
      redeemScriptHex: "aa",
      refundCode: childRefundCode,
      refundLockTime: "123",
      refundPublicKey: deriveToccataLabKeyPair(childRefundCode).xOnlyPublicKey,
      scriptPublicKeyHex: "00aa",
      status: "awaiting_activation" as const,
      title: `Link ${index}`,
    };
  };

  return {
    activation: {
      activationCode,
      activationFeeSompi: "1000000",
      activationPublicKey: deriveToccataLabKeyPair(activationCode).xOnlyPublicKey,
      fundingAddress: `kaspa:${"q".repeat(61)}`,
      fundingAmountSompi: "201000000",
      fundingMatch: null,
      redeemScriptHex: "aa",
      refundCode,
      refundPublicKey: deriveToccataLabKeyPair(refundCode).xOnlyPublicKey,
      status: "awaiting_funding",
    },
    createdAt,
    createdAtMs: Date.parse(createdAt),
    id: "batch-test",
    links: [link(1), link(2)],
    title: "Test batch",
    validFor: "24 hours",
    version: 2,
  };
}

describe("batch claimable recovery", () => {
  it("round-trips a complete private recovery bundle", () => {
    const bundle = createBatchRecoveryBundle(record(), "2026-07-12T11:00:00.000Z");

    expect(parseBatchRecoveryBundle(JSON.stringify(bundle))).toEqual(bundle);
  });

  it("rejects a bundle whose private and public keys do not match", () => {
    const bundle = createBatchRecoveryBundle(record());
    bundle.batch.links[0]!.claimPublicKey = "a".repeat(64);

    expect(() => parseBatchRecoveryBundle(JSON.stringify(bundle))).toThrow(/does not match/i);
  });

  it("rejects incomplete legacy CSV content", () => {
    expect(() => parseBatchRecoveryBundle("title,refund_url\nTest,https://example.com")).toThrow(
      /valid JSON/i,
    );
  });

  it("rejects a bundle whose batch funding total was changed", () => {
    const bundle = createBatchRecoveryBundle(record());
    bundle.batch.activation.fundingAmountSompi = "999000000";

    expect(() => parseBatchRecoveryBundle(JSON.stringify(bundle))).toThrow(/funding total/i);
  });

  it("rejects an activated bundle without canonical child outpoints", () => {
    const bundle = createBatchRecoveryBundle(record());
    bundle.batch.activation.status = "activated";
    bundle.batch.activation.fundingMatch = {
      amountSompi: bundle.batch.activation.fundingAmountSompi,
      blockTime: null,
      outputIndex: 0,
      transactionId: "a".repeat(64),
    };

    expect(() => parseBatchRecoveryBundle(JSON.stringify(bundle))).toThrow(/outpoints/i);
  });
});
