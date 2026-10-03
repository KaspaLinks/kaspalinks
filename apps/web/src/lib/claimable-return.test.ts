import { describe, expect, it, vi } from "vitest";

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { SYSTEM: "SYSTEM" },
  prisma: {},
}));

import {
  returnExpiredClaimable,
  type ClaimableReturnDeps,
  type ReturnableClaimableLink,
} from "./claimable-return";
import { createToccataClaimableAutoReturnScript } from "./toccata-lab";

const RETURN_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const FUNDING_TX = "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309";
const OTHER_TX = "1".repeat(64);

const script = createToccataClaimableAutoReturnScript({
  feeSompi: "200000",
  linkPublicKey: "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
  refundLockTime: "500000000",
  returnAddress: RETURN_ADDRESS,
});

function link(overrides: Partial<ReturnableClaimableLink> = {}): ReturnableClaimableLink {
  return {
    amountSompi: 100_200_000n,
    feeSompi: 200_000n,
    fundingAddress: script.fundingAddress,
    fundingOutputIndex: 0,
    fundingTxId: FUNDING_TX,
    id: "link-1",
    redeemScriptHex: script.redeemScriptHex,
    refundLockTime: "500000000",
    returnAddress: RETURN_ADDRESS,
    scriptVersion: 2,
    status: "funded",
    ...overrides,
  };
}

function deps(overrides: Partial<ClaimableReturnDeps> = {}): ClaimableReturnDeps {
  return {
    broadcast: vi.fn(async (input: { expectedTransactionId: string }) => ({
      submittedTransactionId: input.expectedTransactionId,
    })),
    listUtxos: vi.fn(async () => [
      { amountSompi: 100_200_000n, outputIndex: 0, transactionId: FUNDING_TX },
    ]),
    markReturned: vi.fn(async () => {}),
    readDaaScore: vi.fn(async () => 500_000_000n),
    ...overrides,
  };
}

describe("returnExpiredClaimable", () => {
  it("ignores classic links that need a refund key", async () => {
    const d = deps();
    await expect(returnExpiredClaimable(link({ scriptVersion: 1 }), d)).resolves.toEqual({
      kind: "not_auto_return",
    });
    expect(d.readDaaScore).not.toHaveBeenCalled();
  });

  it("waits for the lock time", async () => {
    const d = deps({ readDaaScore: vi.fn(async () => 499_999_999n) });
    await expect(returnExpiredClaimable(link(), d)).resolves.toMatchObject({ kind: "not_expired" });
    expect(d.listUtxos).not.toHaveBeenCalled();
    expect(d.broadcast).not.toHaveBeenCalled();
  });

  it("returns the funded output to the committed address and records it once", async () => {
    const d = deps();
    const outcome = await returnExpiredClaimable(link(), d);

    expect(outcome).toMatchObject({ kind: "returned" });
    expect(d.broadcast).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(
      (d.broadcast as ReturnType<typeof vi.fn>).mock.calls[0]![0].transactionSafeJson,
    ) as { lockTime: string; outputs: Array<{ value: string }> };
    expect(sent.lockTime).toBe("500000000");
    expect(sent.outputs).toEqual([expect.objectContaining({ value: "100000000" })]);
    expect(d.markReturned).toHaveBeenCalledTimes(1);
    expect(d.markReturned).toHaveBeenCalledWith(
      expect.objectContaining({ fundingTransactionId: FUNDING_TX, linkId: "link-1" }),
    );
  });

  it("returns overpayments and extra outputs separately, skipping dust", async () => {
    const d = deps({
      listUtxos: vi.fn(async () => [
        { amountSompi: 50_000_000n, outputIndex: 1, transactionId: OTHER_TX },
        { amountSompi: 100_200_000n, outputIndex: 0, transactionId: FUNDING_TX },
        { amountSompi: 1_000n, outputIndex: 2, transactionId: OTHER_TX },
      ]),
    });
    const outcome = await returnExpiredClaimable(link(), d);

    expect(outcome.kind).toBe("returned");
    expect(d.broadcast).toHaveBeenCalledTimes(2);
    // The registered funding output is recorded as the link's return.
    expect(d.markReturned).toHaveBeenCalledWith(
      expect.objectContaining({ fundingTransactionId: FUNDING_TX }),
    );
  });

  it("treats an already accepted transaction as returned", async () => {
    const d = deps({
      broadcast: vi.fn(async () => {
        throw new Error("transaction was already accepted by the consensus");
      }),
    });
    await expect(returnExpiredClaimable(link(), d)).resolves.toMatchObject({ kind: "returned" });
    expect(d.markReturned).toHaveBeenCalledTimes(1);
  });

  it("reports nothing to return and does not re-record closed links", async () => {
    await expect(
      returnExpiredClaimable(link(), deps({ listUtxos: vi.fn(async () => []) })),
    ).resolves.toEqual({ kind: "nothing_to_return" });

    const d = deps();
    await returnExpiredClaimable(link({ status: "claimed" }), d);
    expect(d.broadcast).toHaveBeenCalledTimes(1);
    expect(d.markReturned).not.toHaveBeenCalled();
  });

  it("surfaces relay failures", async () => {
    const d = deps({
      broadcast: vi.fn(async () => {
        throw new Error("fee too low");
      }),
    });
    await expect(returnExpiredClaimable(link(), d)).rejects.toThrow("fee too low");
    expect(d.markReturned).not.toHaveBeenCalled();
  });
});
