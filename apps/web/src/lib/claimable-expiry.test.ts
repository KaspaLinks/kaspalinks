import { describe, expect, it } from "vitest";

import { estimateClaimableExpiry, formatClaimableRemainingTime } from "./claimable-expiry";

describe("claimable expiry estimate", () => {
  it("turns a DAA lock time into a remaining wall-clock estimate", () => {
    expect(
      estimateClaimableExpiry({
        currentDaaScore: "1000",
        daaLoadedAtMs: 1_000_000,
        nowMs: 1_000_000,
        refundLockTime: "16300",
      }),
    ).toEqual({
      endsAtMs: 2_530_000,
      expired: false,
      remainingLabel: "25 min 30 sec",
    });
  });

  it("marks a passed lock time as expired", () => {
    expect(
      estimateClaimableExpiry({
        currentDaaScore: "2000",
        daaLoadedAtMs: 1_000_000,
        nowMs: 1_000_000,
        refundLockTime: "1999",
      }),
    ).toEqual({ endsAtMs: 1_000_000, expired: true, remainingLabel: "Expired" });
  });

  it("formats longer durations for the creator list", () => {
    expect(formatClaimableRemainingTime(16_200n)).toBe("4 h 30 min");
  });
});
