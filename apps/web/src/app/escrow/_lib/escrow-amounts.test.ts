import { describe, expect, it } from "vitest";
import {
  computeEscrowAmounts,
  evenSplitPayout,
  formatKasAmount,
  outcomePayout,
  parseKasInput,
  refundPayout,
  releasePayout,
  splitSettlement,
  toPlainKas,
} from "./escrow-amounts";

const KAS = 100_000_000n;

describe("escrow amounts", () => {
  const amounts = computeEscrowAmounts({ priceSompi: 4500n * KAS, shippingSompi: 50n * KAS });

  it("locks only the V1 buyer payment", () => {
    expect(amounts).toMatchObject({
      buyerLockSompi: 4550n * KAS,
      itemTotalSompi: 4550n * KAS,
      totalLockedSompi: 4550n * KAS,
    });
  });

  it("pays out exactly what is locked", () => {
    expect(releasePayout(amounts)).toEqual({ buyerSompi: 0n, sellerSompi: 4550n * KAS });
    expect(refundPayout(amounts)).toEqual({ buyerSompi: 4550n * KAS, sellerSompi: 0n });
    const split = evenSplitPayout(amounts);
    expect(split.buyerSompi + split.sellerSompi).toBe(amounts.totalLockedSompi);
  });

  it("reports terminal payouts", () => {
    const base = {
      fundedAt: "2026-09-10T12:00:00.000Z",
      priceSompi: 1000n * KAS,
      settlement: null,
      shippingSompi: 0n,
    };
    expect(outcomePayout({ ...base, status: "claimed" })).toEqual({
      buyerSompi: 0n,
      sellerSompi: 1000n * KAS,
    });
    expect(outcomePayout({ ...base, status: "refunded" })).toEqual({
      buyerSompi: 1000n * KAS,
      sellerSompi: 0n,
    });
    expect(outcomePayout({ ...base, fundedAt: null, status: "cancelled_unfunded" })).toEqual({
      buyerSompi: 0n,
      sellerSompi: 0n,
    });
    expect(outcomePayout({ ...base, status: "active" })).toBeNull();
  });

  it("formats and parses KAS without floating point", () => {
    expect(formatKasAmount(1_234_567n * KAS + 1n)).toBe("1,234,567.00000001");
    expect(formatKasAmount(20_000_000n)).toBe("0.2");
    expect(toPlainKas(457_275_000_000n)).toBe("4572.75");
    expect(parseKasInput("4500,5", { allowZero: false })).toEqual({
      ok: true,
      sompi: 450_050_000_000n,
    });
    expect(parseKasInput("1e3", { allowZero: false }).ok).toBe(false);
  });

  it("requires settlement shares to equal the locked total", () => {
    expect(splitSettlement("1000", 1500n * KAS)).toEqual({
      buyerSompi: 1000n * KAS,
      ok: true,
      sellerSompi: 500n * KAS,
    });
    expect(splitSettlement("1500.00000001", 1500n * KAS)).toMatchObject({ ok: false });
  });
});
