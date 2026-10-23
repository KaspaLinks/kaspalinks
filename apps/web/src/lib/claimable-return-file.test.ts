import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { SYSTEM: "SYSTEM" },
  prisma: {},
}));

import {
  buildClaimableReturnFile,
  CLAIMABLE_RETURN_FILE_FORMAT,
  type ClaimableReturnFileLink,
} from "./claimable-return-file";
import { returnExpiredClaimable, type ClaimableReturnDeps } from "./claimable-return";
import { createToccataClaimableAutoReturnScript } from "./toccata-lab";

const RETURN_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const FUNDING_TX = "0d9549eb73606202fbb4fb92605da289d530489ef2f53e2d7f95a1a0d588a309";

const script = createToccataClaimableAutoReturnScript({
  feeSompi: "200000",
  linkPublicKey: "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa",
  refundLockTime: "500000000",
  returnAddress: RETURN_ADDRESS,
});

function link(overrides: Partial<ClaimableReturnFileLink> = {}): ClaimableReturnFileLink {
  return {
    amountSompi: 100_200_000n,
    feeSompi: 200_000n,
    fundingAddress: script.fundingAddress,
    fundingOutputIndex: 0,
    fundingTxId: FUNDING_TX,
    linkKey: "lab-abc123",
    redeemScriptHex: script.redeemScriptHex,
    refundLockTime: "500000000",
    returnAddress: RETURN_ADDRESS,
    scriptVersion: 2,
    ...overrides,
  };
}

describe("buildClaimableReturnFile", () => {
  it("prepares the exact transaction the worker would broadcast after expiry", async () => {
    const file = buildClaimableReturnFile(link());
    expect(file).not.toBeNull();
    if (!file) return;

    const broadcast = vi.fn(async (input: { expectedTransactionId: string }) => ({
      submittedTransactionId: input.expectedTransactionId,
    }));
    const deps: ClaimableReturnDeps = {
      broadcast,
      listUtxos: async () => [
        { amountSompi: 100_200_000n, outputIndex: 0, transactionId: FUNDING_TX },
      ],
      markReturned: async () => {},
      readDaaScore: async () => 500_000_001n,
    };
    await returnExpiredClaimable({ ...link(), id: "link-1", status: "shared" }, deps);

    expect(broadcast).toHaveBeenCalledWith({
      expectedTransactionId: file.expectedTransactionId,
      transactionSafeJson: file.transactionSafeJson,
    });
  });

  it("can only pay the committed return address and waits for the lock time", () => {
    const file = buildClaimableReturnFile(link());
    if (!file) throw new Error("expected a return file");
    const kaspa = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
    const transaction = kaspa.Transaction.deserializeFromSafeJSON(file.transactionSafeJson);

    expect(file).toMatchObject({
      format: CLAIMABLE_RETURN_FILE_FORMAT,
      fundingOutpoint: { index: 0, transactionId: FUNDING_TX },
      returnAddress: RETURN_ADDRESS,
      returnAfterDaaScore: "500000000",
      returnSompi: "100000000",
    });
    expect(transaction.id).toBe(file.expectedTransactionId);
    expect(transaction.lockTime).toBe(500_000_000n);
    expect(transaction.outputs).toHaveLength(1);
    expect(transaction.outputs[0]?.value).toBe(100_000_000n);
    expect(transaction.outputs[0]?.scriptPublicKey.script).toBe(
      kaspa.payToAddressScript(RETURN_ADDRESS).script,
    );
    expect(transaction.inputs[0]?.previousOutpoint.transactionId).toBe(FUNDING_TX);
  });

  it.each([
    ["an older refund-key link", { returnAddress: null, scriptVersion: 1 }],
    ["an unfunded link", { fundingOutputIndex: null, fundingTxId: null }],
    ["an amount below the return minimum", { amountSompi: 10_000_000n }],
  ])("has no return file for %s", (_label, overrides) => {
    expect(buildClaimableReturnFile(link(overrides))).toBeNull();
  });
});
