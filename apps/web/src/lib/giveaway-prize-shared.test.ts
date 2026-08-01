import { describe, expect, it } from "vitest";

import {
  GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS,
  GIVEAWAY_FUNDING_GRACE_SECONDS,
  giveawayRefundDelaySeconds,
  shouldPrepareGiveawayClaim,
} from "./giveaway-prize-shared";

describe("giveaway prize timing", () => {
  it("keeps the entry and winner claim windows ahead of the refund branch", () => {
    const sevenDays = 7 * 24 * 60 * 60;
    expect(giveawayRefundDelaySeconds(sevenDays)).toBe(
      GIVEAWAY_FUNDING_GRACE_SECONDS +
        sevenDays +
        GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS +
        Math.ceil((sevenDays + GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS) * 0.02),
    );
  });

  it("rejects invalid entry windows", () => {
    expect(() => giveawayRefundDelaySeconds(0)).toThrow(/positive/);
  });

  it("rejects winner claim windows outside the supported range", () => {
    expect(() => giveawayRefundDelaySeconds(60, 59)).toThrow(/outside/);
    expect(() => giveawayRefundDelaySeconds(60, 8 * 24 * 60 * 60)).toThrow(/outside/);
  });
});

describe("shouldPrepareGiveawayClaim", () => {
  const ready = {
    claimTxId: null,
    fundingOutputIndex: 0,
    fundingTxId: "f".repeat(64),
    preparedTransactionId: null,
    prizeStatus: "funded",
    status: "DRAWN",
    winnerAddress: `kaspa:${"q".repeat(61)}`,
  };

  it("allows a funded and drawn prize that is not prepared yet", () => {
    expect(shouldPrepareGiveawayClaim(ready)).toBe(true);
  });

  it.each([
    { input: { ...ready, claimTxId: "c".repeat(64) }, reason: "after claim" },
    { input: { ...ready, fundingTxId: null }, reason: "without funding" },
    {
      input: { ...ready, preparedTransactionId: "p".repeat(64) },
      reason: "after preparation",
    },
    { input: { ...ready, prizeStatus: "refunded" }, reason: "after refund" },
    { input: { ...ready, status: "OPEN" }, reason: "before the draw" },
    { input: { ...ready, winnerAddress: null }, reason: "without a winner" },
  ])("refuses claim preparation $reason", ({ input }) => {
    expect(shouldPrepareGiveawayClaim(input)).toBe(false);
  });
});
