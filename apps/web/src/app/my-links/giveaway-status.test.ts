import { describe, expect, it } from "vitest";

import { giveawayDisplayState, type GiveawayDisplayInput } from "./giveaway-status";

const drawnGiveaway: GiveawayDisplayInput = {
  prize: { claimTxId: null, funded: true, status: "funded" },
  status: "DRAWN",
  winnerClaim: {
    expiresAt: "2026-08-03T12:00:00.000Z",
    preparedTransactionId: "prepared-tx",
  },
};

describe("giveaway display status", () => {
  it("shows that a prepared winner prize is still waiting to be claimed", () => {
    expect(giveawayDisplayState(drawnGiveaway, Date.parse("2026-08-02T12:00:00.000Z"))).toEqual({
      detail: "The winner can open the giveaway page and claim the prize now.",
      label: "Winner can claim",
      toneClass: "status-pending",
    });
  });

  it("shows a confirmed on-chain claim as claimed", () => {
    expect(
      giveawayDisplayState({
        ...drawnGiveaway,
        prize: { claimTxId: "claim-tx", funded: true, status: "claimed" },
      }),
    ).toMatchObject({ label: "Claimed by winner", toneClass: "status-confirmed" });
  });

  it("shows an expired unclaimed winner prize as ready to refund", () => {
    expect(
      giveawayDisplayState(drawnGiveaway, Date.parse("2026-08-04T12:00:00.000Z")),
    ).toMatchObject({ label: "Refund available", toneClass: "status-pending" });
  });

  it("distinguishes a refunded prize from a claimed prize", () => {
    expect(
      giveawayDisplayState({
        ...drawnGiveaway,
        prize: { claimTxId: null, funded: true, status: "refunded" },
      }),
    ).toMatchObject({ label: "Refunded to creator", toneClass: "status-profile-hidden" });
  });

  it("does not call an unrelated recorded spend a winner claim", () => {
    expect(
      giveawayDisplayState({
        ...drawnGiveaway,
        prize: { claimTxId: "other-spend", funded: true, status: "spent_unknown" },
      }),
    ).toMatchObject({ label: "Spent on-chain", toneClass: "status-failed" });
  });
});
