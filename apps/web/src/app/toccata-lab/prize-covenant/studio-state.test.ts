import { describe, expect, it } from "vitest";
import { studioState, studioRefundReady, remainingTime, type StudioDetail } from "./studio-state";
const detail = (): StudioDetail => ({
  id: "test",
  manifest: {
    version: 4,
    network: "mainnet",
    creatorPublicKeyHex: "11".repeat(32),
    platformPublicKeyHex: "22".repeat(32),
    prizeSompi: "20000000",
    freezeFeeSompi: "1000000",
    entropyTargetBlueScore: "1600",
    entries: [],
    closesAtDaa: "1000",
    refundDaa: "34000",
    drawFeeSompi: "1000000",
  },
  entryCount: 0,
  terms: { fundingSompi: "22000000", open: { address: "" }, frozen: { address: "" } },
  chain: { daa: "900", blueScore: "900" },
  open: [],
  frozen: [],
});
describe("studio guidance", () => {
  it("requires backup before showing funding", () => {
    expect(studioState(detail(), true, false)).toBe("backup");
    expect(studioState(detail(), true, true)).toBe("fund");
  });
  it("distinguishes exact funding from dust or wrong amount", () => {
    const d = detail();
    d.open = [{ amount: "1" }];
    expect(studioState(d, true, true)).toBe("mismatch");
    d.open.push({ amount: "22000000" });
    expect(studioState(d, true, false)).toBe("active");
  });
  it("never offers funding for a closed unfunded giveaway", () => {
    const d = detail();
    d.chain.daa = "1001";
    expect(studioState(d, true, true)).toBe("closed");
  });
  it("requires fresh chain data before offering actions", () => {
    expect(studioState(detail(), false, true)).toBe("checking");
  });
  it("waits for empty freeze then enables early V4 recovery", () => {
    const d = detail();
    d.chain.daa = "1001";
    d.open = [{ amount: "22000000" }];
    expect(studioState(d, true, true)).toBe("refund-wait");
    d.open = [];
    d.frozen = [{ amount: "21000000" }];
    expect(studioState(d, true, true)).toBe("refund");
    d.manifest.version = 3;
    expect(studioRefundReady(d, "frozen")).toBe(false);
  });
  it("does not resubmit a pending refund while indexer still lists its input", () => {
    const d = detail();
    d.chain.daa = "34001";
    d.open = [{ amount: "22000000" }];
    d.refund = { transactionId: "tx", confirmed: false, address: null, amount: null };
    expect(studioState(d, true, true)).toBe("refunding");
  });
  it("restores confirmed refund and payout without returning to funding", () => {
    const d = detail();
    d.refund = { transactionId: "tx", confirmed: true, address: "kaspa:test", amount: "21000000" };
    expect(studioState(d, true, false)).toBe("refunded");
    d.refund = null;
    d.payout = { transactionId: "tx", confirmed: true, winnerAddress: "kaspa:test" };
    expect(studioState(d, true, false)).toBe("paid");
  });
  it("shows an estimated duration without negative time", () => {
    expect(remainingTime("900", "1000")).toBe("less than a minute");
    expect(remainingTime("36000", "0")).toBe("1 h");
  });
});
