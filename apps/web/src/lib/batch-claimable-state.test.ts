import { describe, expect, it } from "vitest";

import type { BatchRecoveryRecord } from "./batch-claimable-recovery";
import { reconcileBatchWithServer, type RegisteredBatchState } from "./batch-claimable-state";

function batchRecord(): BatchRecoveryRecord {
  const link = (index: number): BatchRecoveryRecord["links"][number] => ({
    amountKas: "1.002",
    amountSompi: "100200000",
    claimCode: String(index + 1).padStart(64, "0"),
    claimPublicKey: "a".repeat(64),
    description: "Test",
    feeKas: "0.002",
    feeSompi: "200000",
    fundingAddress: `kaspa:${"q".repeat(61)}`,
    fundingMatch: null,
    id: `batch-test-0${index}`,
    netClaimKas: "1",
    redeemScriptHex: "aa",
    refundCode: String(index + 10).padStart(64, "0"),
    refundLockTime: "500000000",
    refundPublicKey: "b".repeat(64),
    scriptPublicKeyHex: "00aa",
    status: "awaiting_activation",
    title: `Link ${index}`,
  });
  return {
    activation: {
      activationCode: "1".padStart(64, "0"),
      activationFeeSompi: "1000000",
      activationPublicKey: "c".repeat(64),
      fundingAddress: `kaspa:${"q".repeat(61)}`,
      fundingAmountSompi: "201400000",
      fundingMatch: {
        amountSompi: "201400000",
        blockTime: null,
        outputIndex: 0,
        transactionId: "d".repeat(64),
      },
      redeemScriptHex: "aa",
      refundCode: "2".padStart(64, "0"),
      refundPublicKey: "e".repeat(64),
      status: "funded",
    },
    batchManifestRegisteredAt: "2026-07-19T08:00:00.000Z",
    createdAt: "2026-07-19T08:00:00.000Z",
    createdAtMs: Date.parse("2026-07-19T08:00:00.000Z"),
    id: "batch-test",
    links: [link(1), link(2)],
    title: "Test batch",
    validFor: "24 hours",
    version: 2,
  };
}

function serverState(): RegisteredBatchState {
  return {
    activationTxId: "f".repeat(64),
    fundingOutputIndex: 0,
    fundingTxId: "d".repeat(64),
    outputs: [
      {
        claimTxId: "1".repeat(64),
        deletedAt: null,
        fundingOutputIndex: 0,
        fundingTxId: "f".repeat(64),
        linkKey: "batch-test-01",
        outputIndex: 0,
        refundTxId: null,
        status: "claimed",
      },
      {
        claimTxId: null,
        deletedAt: "2026-07-19T09:00:00.000Z",
        fundingOutputIndex: 1,
        fundingTxId: "f".repeat(64),
        linkKey: "batch-test-02",
        outputIndex: 1,
        refundTxId: null,
        status: "funded",
      },
    ],
    refundTxId: null,
    status: "activated",
  };
}

describe("batch claimable state reconciliation", () => {
  it("merges public child status without changing browser-held private codes", () => {
    const batch = batchRecord();
    const next = reconcileBatchWithServer(batch, serverState());

    expect(next.activation.status).toBe("activated");
    expect(next.links[0]).toMatchObject({
      claimCode: batch.links[0]!.claimCode,
      refundCode: batch.links[0]!.refundCode,
      status: "claimed",
    });
    expect(next.links[1]).toMatchObject({
      deletedAt: "2026-07-19T09:00:00.000Z",
      fundingMatch: { outputIndex: 1, transactionId: "f".repeat(64) },
      status: "funded",
    });
  });

  it("does not regress a local terminal child while the server is briefly stale", () => {
    const batch = batchRecord();
    batch.activation.status = "activated";
    batch.links[0]!.status = "refunded";
    const server = serverState();
    server.outputs[0]!.status = "funded";

    expect(reconcileBatchWithServer(batch, server).links[0]!.status).toBe("refunded");
  });

  it("does not regress funded activation while the server is briefly stale", () => {
    const batch = batchRecord();
    const server = serverState();
    server.status = "awaiting_funding";
    server.fundingTxId = null;
    server.fundingOutputIndex = null;

    const next = reconcileBatchWithServer(batch, server);

    expect(next.activation.status).toBe("funded");
    expect(next.activation.fundingMatch).toEqual(batch.activation.fundingMatch);
  });

  it.each(["activated", "refunded"] as const)(
    "does not replace local terminal activation status %s",
    (status) => {
      const batch = batchRecord();
      batch.activation.status = status;
      const server = serverState();
      server.status = status === "activated" ? "refunded" : "activated";

      expect(reconcileBatchWithServer(batch, server).activation.status).toBe(status);
    },
  );

  it("advances funded activation to a terminal server status", () => {
    const batch = batchRecord();
    const server = serverState();
    server.status = "refunded";

    expect(reconcileBatchWithServer(batch, server).activation.status).toBe("refunded");
  });

  it("returns the original record when public state is unchanged", () => {
    const batch = batchRecord();
    const server = serverState();
    batch.activation.status = "activated";
    batch.links[0]!.status = "claimed";
    batch.links[0]!.fundingMatch = {
      amountSompi: batch.links[0]!.amountSompi,
      blockTime: null,
      outputIndex: 0,
      transactionId: server.activationTxId!,
    };
    batch.links[1]!.status = "funded";
    batch.links[1]!.deletedAt = server.outputs[1]!.deletedAt!;
    batch.links[1]!.fundingMatch = {
      amountSompi: batch.links[1]!.amountSompi,
      blockTime: null,
      outputIndex: 1,
      transactionId: server.activationTxId!,
    };

    expect(reconcileBatchWithServer(batch, server)).toBe(batch);
  });
});
