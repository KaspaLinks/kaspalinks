import { describe, expect, it } from "vitest";
import {
  giveawayFundingDeadline,
  giveawayProgress,
  giveawaySetupSchema,
  validateGiveawaySetup,
} from "./giveaway-setup";

const settings = {
  title: "Weekend",
  description: "",
  amountKas: "10",
  durationValue: "24",
  durationUnit: "hours" as const,
  winnerClaimValue: "24",
  winnerClaimUnit: "hours" as const,
  escrowPrize: true,
  autoPrepareClaim: true,
};
const now = Date.parse("2026-09-07T12:00:00Z");
const giveaway = {
  status: "OPEN",
  closesAt: new Date(now + 60000).toISOString(),
  createdAt: new Date(now - 1000).toISOString(),
  prize: { status: "funded", funded: true },
  winnerClaim: { preparedTransactionId: null as string | null, expiresAt: null as string | null },
};

describe("giveaway setup", () => {
  it("keeps amounts exact and validates both windows before creating recovery", () => {
    const result = validateGiveawaySetup({ ...settings, amountKas: "1.00000001" });
    expect(result.plan?.utxoSompi).toBe(100200001n);
    expect(result.entryWindowSeconds).toBe(86400);
    for (const amountKas of ["1e2", "-1", "0", "1.000000001", "NaN", "99999999999999"])
      expect(() => validateGiveawaySetup({ ...settings, amountKas })).toThrow();
    for (const durationValue of ["0", "1.5", "169", "1e1"])
      expect(() => validateGiveawaySetup({ ...settings, durationValue })).toThrow();
    expect(() => validateGiveawaySetup({ ...settings, winnerClaimValue: "169" })).toThrow();
  });
  it("preserves the supported minimum for a manual prize", () => {
    expect(
      validateGiveawaySetup({ ...settings, escrowPrize: false, amountKas: "0.2" }).plan,
    ).toBeNull();
  });
  it("strips authentication and recovery material from restored public settings", () => {
    expect(
      giveawaySetupSchema.parse({
        ...settings,
        token: "test",
        claimCode: "test",
        refundCode: "test",
      }),
    ).toEqual(settings);
  });
  it("uses the contract funding deadline even if the giveaway was created later", () => {
    const input = {
      ...giveaway,
      status: "PENDING_FUNDING",
      fundingExpiresAt: new Date(now - 1).toISOString(),
    };
    expect(giveawayProgress(input, now).step).toBe("attention");
    expect(giveawayFundingDeadline({ fundingExpiresAt: "invalid" })).toBe(0);
    expect(giveawayFundingDeadline({})).toBe(0);
    expect(giveawayProgress({ ...giveaway, status: "PENDING_FUNDING" }, now).step).toBe("fund");
  });
  it("distinguishes drawing, signing, waiting for winner and completion", () => {
    expect(giveawayProgress(giveaway, now).step).toBe("open");
    expect(giveawayProgress(giveaway, now + 60000).step).toBe("draw");
    const drawn = { ...giveaway, status: "DRAWN" };
    expect(giveawayProgress(drawn, now).step).toBe("payout");
    expect(
      giveawayProgress(
        { ...drawn, winnerClaim: { preparedTransactionId: "tx", expiresAt: null } },
        now,
      ).step,
    ).toBe("claim");
    expect(
      giveawayProgress({ ...drawn, prize: { status: "claimed", funded: true } }, now).step,
    ).toBe("complete");
  });
  it("never advertises an unknown spend or expired claim as available", () => {
    expect(
      giveawayProgress({ ...giveaway, prize: { status: "spent_unknown", funded: true } }, now).step,
    ).toBe("attention");
    expect(
      giveawayProgress(
        {
          ...giveaway,
          status: "DRAWN",
          winnerClaim: { preparedTransactionId: "tx", expiresAt: new Date(now).toISOString() },
        },
        now,
      ).step,
    ).toBe("refund");
    expect(giveawayProgress({ ...giveaway, status: "CANCELLED" }, now).step).toBe("refund");
    expect(giveawayProgress({ ...giveaway, status: "NO_ENTRIES", prize: null }, now).step).toBe(
      "complete",
    );
  });
});
