import { describe, expect, it } from "vitest";

import {
  calculateToccataCanaryAllowedScriptUnits,
  formatSompiForToccataLab,
  parseToccataCanaryFeeKasToSompi,
  parseToccataCanaryFundingKasToSompi,
  planToccataCanaryExpiry,
  planToccataCanarySpend,
  planToccataCanarySpendFromKas,
  TOCCATA_CANARY_DEFAULT_FEE_SOMPI,
} from "./toccata-lab-fee";

describe("Claimable link fee planner", () => {
  it("plans the accepted mainnet canary fee and net output", () => {
    const plan = planToccataCanarySpend({ utxoSompi: "25000000" });

    expect(plan.feeSompi).toBe(TOCCATA_CANARY_DEFAULT_FEE_SOMPI);
    expect(plan.feeKas).toBe("0.002");
    expect(plan.netOutputSompi).toBe(24_800_000n);
    expect(plan.netOutputKas).toBe("0.248");
    expect(plan.meetsMinimumOutput).toBe(true);
    expect(plan.computeBudget).toBe(11);
    expect(plan.allowedScriptUnits).toBe(119_999);
    expect(plan.scriptUnitsHeadroom).toBe(19_706);
  });

  it("surfaces the safe maximum fee for tiny canaries", () => {
    const plan = planToccataCanarySpend({ feeSompi: "400000", utxoSompi: "20200000" });

    expect(plan.meetsMinimumOutput).toBe(false);
    expect(plan.maxSafeFeeSompi).toBe(200_000n);
    expect(plan.maxSafeFeeKas).toBe("0.002");
  });

  it("rejects non-integer fee input", () => {
    expect(() => planToccataCanarySpend({ feeSompi: "0.002", utxoSompi: "25000000" })).toThrow(
      "Fee sompi must be a whole number.",
    );
  });

  it("rejects fees that consume the whole UTXO", () => {
    expect(() => planToccataCanarySpend({ feeSompi: "25000000", utxoSompi: "25000000" })).toThrow(
      "Fee must be lower than the funded amount.",
    );
  });

  it("keeps the documented Toccata script-unit allowance formula visible", () => {
    expect(calculateToccataCanaryAllowedScriptUnits(11)).toBe(119_999);
    expect(calculateToccataCanaryAllowedScriptUnits(0)).toBe(9_999);
  });

  it("formats sompi without floating point arithmetic", () => {
    expect(formatSompiForToccataLab(200_000n)).toBe("0.002");
    expect(formatSompiForToccataLab(24_800_000n)).toBe("0.248");
    expect(formatSompiForToccataLab(100_000_000n)).toBe("1");
  });

  it("plans funding from a user-facing KAS amount", () => {
    const plan = planToccataCanarySpendFromKas({ amountKas: "1.25" });

    expect(plan.utxoSompi).toBe(125_000_000n);
    expect(plan.utxoKas).toBe("1.25");
    expect(plan.netOutputKas).toBe("1.248");
  });

  it("plans fees from a user-facing KAS fee", () => {
    const plan = planToccataCanarySpendFromKas({ amountKas: "1.25", feeKas: "0.003" });

    expect(plan.feeSompi).toBe(300_000n);
    expect(plan.feeKas).toBe("0.003");
    expect(plan.netOutputKas).toBe("1.247");
  });

  it("accepts comma decimal input for mobile KAS amount entry", () => {
    expect(parseToccataCanaryFundingKasToSompi("1,25")).toBe(125_000_000n);
  });

  it("accepts comma decimal input for mobile KAS fee entry", () => {
    expect(parseToccataCanaryFeeKasToSompi("0,002")).toBe(200_000n);
  });

  it("rejects zero KAS fees", () => {
    expect(() => parseToccataCanaryFeeKasToSompi("0")).toThrow(
      "Claim/refund fee must be greater than zero.",
    );
  });

  it("rejects new claimable-link amounts below 1 KAS", () => {
    expect(() => parseToccataCanaryFundingKasToSompi("0.999")).toThrow(
      "Claim amount must be at least 1 KAS.",
    );
  });

  it("plans refund DAA lock time from a validity duration", () => {
    const plan = planToccataCanaryExpiry({
      currentDaaScore: "477506357",
      durationValue: "24",
      unit: "hours",
    });

    expect(plan.durationLabel).toBe("24 hours");
    expect(plan.durationSeconds).toBe(86_400n);
    expect(plan.daaOffset).toBe(864_000n);
    expect(plan.refundLockTime).toBe(478_370_357n);
  });

  it("allows minute-level expiry for claim windows", () => {
    const plan = planToccataCanaryExpiry({
      currentDaaScore: "477506357",
      durationValue: "5",
      unit: "minutes",
    });

    expect(plan.durationLabel).toBe("5 minutes");
    expect(plan.durationSeconds).toBe(300n);
    expect(plan.daaOffset).toBe(3_000n);
    expect(plan.refundLockTime).toBe(477_509_357n);
  });

  it("caps claim expiry duration", () => {
    expect(() =>
      planToccataCanaryExpiry({
        currentDaaScore: "477506357",
        durationValue: "31",
        unit: "days",
      }),
    ).toThrow("Claim validity must be 30 days or less.");
  });
});
