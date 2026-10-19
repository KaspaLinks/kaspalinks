import { describe, expect, it, vi } from "vitest";

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { SYSTEM: "SYSTEM" },
  prisma: {},
}));

import {
  returnExpiredClaimBatch,
  type ClaimBatchReturnDeps,
  type ReturnableClaimBatch,
} from "./claimable-batch-return";
import {
  createToccataBatchAllocatorLabScript,
  createToccataClaimableAutoReturnScript,
} from "./toccata-lab";

const RETURN_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const FUNDING_TX = "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309";

const children = ["11", "22"].map((byte) =>
  createToccataClaimableAutoReturnScript({
    feeSompi: "200000",
    linkPublicKey: byte.repeat(32),
    refundLockTime: "500000000",
    returnAddress: RETURN_ADDRESS,
  }),
);
const allocator = createToccataBatchAllocatorLabScript({
  activationPublicKey: "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
  autoReturn: { feeSompi: "1000000", returnAddress: RETURN_ADDRESS },
  outputs: children.map((child) => ({
    amountSompi: "100200000",
    scriptPublicKeyHex: `0000${child.scriptPublicKey.script}`,
  })),
  refundLockTime: "500000000",
});

function batch(overrides: Partial<ReturnableClaimBatch> = {}): ReturnableClaimBatch {
  return {
    activationTxId: null,
    creatorId: "creator-1",
    expectedOutputs: [],
    fundingAddress: allocator.fundingAddress,
    fundingOutputIndex: null,
    fundingTxId: null,
    id: "batch-1",
    redeemScriptHex: allocator.redeemScriptHex,
    refundLockTime: "500000000",
    returnAddress: RETURN_ADDRESS,
    returnFeeSompi: 1_000_000n,
    scriptVersion: 2,
    status: "funded",
    ...overrides,
  };
}

function deps(overrides: Partial<ClaimBatchReturnDeps> = {}): ClaimBatchReturnDeps {
  return {
    broadcast: vi.fn(async (input: { expectedTransactionId: string }) => ({
      submittedTransactionId: input.expectedTransactionId,
    })),
    listUtxos: vi.fn(async () => [
      { amountSompi: 201_400_000n, outputIndex: 0, transactionId: FUNDING_TX },
    ]),
    markBatchReturned: vi.fn(async () => {}),
    readDaaScore: vi.fn(async () => 500_000_000n),
    ...overrides,
  };
}

describe("returnExpiredClaimBatch", () => {
  it("ignores classic drops that need a refund key", async () => {
    const d = deps();
    await expect(
      returnExpiredClaimBatch(batch({ returnAddress: null, scriptVersion: 1 }), d),
    ).resolves.toEqual({ kind: "not_auto_return" });
    expect(d.readDaaScore).not.toHaveBeenCalled();
  });

  it("waits for the lock time", async () => {
    const d = deps({ readDaaScore: vi.fn(async () => 499_999_999n) });
    await expect(returnExpiredClaimBatch(batch(), d)).resolves.toEqual({ kind: "not_expired" });
    expect(d.listUtxos).not.toHaveBeenCalled();
  });

  it("sends the unactivated allocator back to the return address and closes the drop once", async () => {
    const d = deps();
    const outcome = await returnExpiredClaimBatch(batch(), d);

    expect(outcome).toMatchObject({ kind: "returned" });
    const sent = JSON.parse(
      (d.broadcast as ReturnType<typeof vi.fn>).mock.calls[0]![0].transactionSafeJson,
    ) as { lockTime: string; outputs: Array<{ value: string }> };
    expect(sent.lockTime).toBe("500000000");
    expect(sent.outputs).toEqual([expect.objectContaining({ value: "200400000" })]);
    expect(d.markBatchReturned).toHaveBeenCalledTimes(1);
    expect(d.markBatchReturned).toHaveBeenCalledWith(
      expect.objectContaining({ fundingOutputIndex: 0, fundingTransactionId: FUNDING_TX }),
    );
  });

  it("returns extra payments to an activated allocator without reopening the drop", async () => {
    const d = deps();
    await returnExpiredClaimBatch(
      batch({ activationTxId: "f".repeat(64), status: "activated" }),
      d,
    );

    expect(d.broadcast).toHaveBeenCalledTimes(1);
    expect(d.markBatchReturned).not.toHaveBeenCalled();
  });

  it("skips dust and reports nothing to return", async () => {
    const d = deps({
      listUtxos: vi.fn(async () => [
        { amountSompi: 1_100_000n, outputIndex: 0, transactionId: FUNDING_TX },
      ]),
    });
    await expect(returnExpiredClaimBatch(batch(), d)).resolves.toEqual({
      kind: "nothing_to_return",
    });
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("treats an already accepted return as done", async () => {
    const d = deps({
      broadcast: vi.fn(async () => {
        throw new Error("transaction was already accepted by the consensus");
      }),
    });
    await expect(returnExpiredClaimBatch(batch(), d)).resolves.toMatchObject({
      kind: "returned",
    });
    expect(d.markBatchReturned).toHaveBeenCalledTimes(1);
  });
});
