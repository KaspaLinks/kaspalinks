import { describe, expect, it } from "vitest";

import {
  computeDepositSompi,
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
  it("adds equal deposits on top of price and shipping", () => {
    const amounts = computeEscrowAmounts({
      depositRateBps: 5000,
      priceSompi: 4500n * KAS,
      shippingSompi: 50n * KAS,
    });

    expect(amounts.itemTotalSompi).toBe(4550n * KAS);
    expect(amounts.buyerDepositSompi).toBe(2275n * KAS);
    expect(amounts.sellerDepositSompi).toBe(2275n * KAS);
    expect(amounts.buyerLockSompi).toBe(6825n * KAS);
    expect(amounts.totalLockedSompi).toBe(9100n * KAS);
  });

  it("keeps sompi precision instead of rounding through floats", () => {
    // 1,935 KAS * 25% = 483.75 KAS exactly.
    expect(computeDepositSompi(1935n * KAS, 2500)).toBe(48_375_000_000n);
    // 0.30000001 KAS * 50% floors to whole sompi.
    expect(computeDepositSompi(30_000_001n, 5000)).toBe(15_000_000n);
    expect(computeDepositSompi(725n * KAS, 0)).toBe(0n);
  });

  it("pays out exactly what is locked for release and refund", () => {
    const amounts = computeEscrowAmounts({
      depositRateBps: 2500,
      priceSompi: 9400n * KAS,
      shippingSompi: 80n * KAS,
    });

    for (const payout of [releasePayout(amounts), refundPayout(amounts)]) {
      expect(payout.buyerSompi + payout.sellerSompi).toBe(amounts.totalLockedSompi);
    }
    expect(releasePayout(amounts)).toEqual({
      buyerSompi: 2370n * KAS,
      sellerSompi: 11_850n * KAS,
    });
    expect(refundPayout(amounts)).toEqual({
      buyerSompi: 11_850n * KAS,
      sellerSompi: 2370n * KAS,
    });
  });

  it("reports what each side received once an escrow closes", () => {
    const base = {
      depositRateBps: 5000 as const,
      fundedAt: "2026-09-10T12:00:00.000Z",
      priceSompi: 1000n * KAS,
      settlement: null,
      shippingSompi: 0n,
    };

    expect(outcomePayout({ ...base, status: "released" })).toEqual({
      buyerSompi: 500n * KAS,
      sellerSompi: 1500n * KAS,
    });
    expect(outcomePayout({ ...base, status: "cancelled" })).toEqual({
      buyerSompi: 1500n * KAS,
      sellerSompi: 500n * KAS,
    });
    expect(outcomePayout({ ...base, fundedAt: null, status: "expired" })).toEqual({
      buyerSompi: 0n,
      sellerSompi: 500n * KAS,
    });
    expect(outcomePayout({ ...base, status: "shipped" })).toBeNull();

    const amounts = computeEscrowAmounts(base);
    const even = evenSplitPayout(amounts);
    expect(even).toEqual({ buyerSompi: 1000n * KAS, sellerSompi: 1000n * KAS });
    expect(even.buyerSompi + even.sellerSompi).toBe(amounts.totalLockedSompi);
  });

  it("formats KAS with grouping and without trailing zeros", () => {
    expect(formatKasAmount(457_275_000_000n)).toBe("4,572.75");
    expect(formatKasAmount(12_920n * KAS)).toBe("12,920");
    expect(formatKasAmount(1_234_567n * KAS + 1n)).toBe("1,234,567.00000001");
    expect(formatKasAmount(20_000_000n)).toBe("0.2");
    expect(formatKasAmount(0n)).toBe("0");
    expect(() => formatKasAmount(-1n)).toThrow();
    expect(toPlainKas(457_275_000_000n)).toBe("4572.75");
    expect(toPlainKas(0n)).toBe("0");
  });

  it("parses user KAS input with the shared amount rules", () => {
    expect(parseKasInput("4500,5", { allowZero: false })).toEqual({
      ok: true,
      sompi: 450_050_000_000n,
    });
    expect(parseKasInput("0", { allowZero: true })).toEqual({ ok: true, sompi: 0n });
    expect(parseKasInput("0.00", { allowZero: true })).toEqual({ ok: true, sompi: 0n });
    expect(parseKasInput("0", { allowZero: false }).ok).toBe(false);
    expect(parseKasInput("", { allowZero: true }).ok).toBe(false);
    expect(parseKasInput("1e3", { allowZero: false }).ok).toBe(false);
    expect(parseKasInput("1.123456789", { allowZero: false }).ok).toBe(false);
  });

  it("splits a settlement so both shares add up to the locked total", () => {
    const total = 14_220n * KAS;

    expect(splitSettlement("3370", total)).toEqual({
      buyerSompi: 3370n * KAS,
      ok: true,
      sellerSompi: 10_850n * KAS,
    });
    expect(splitSettlement("0", total)).toEqual({ buyerSompi: 0n, ok: true, sellerSompi: total });
    expect(splitSettlement("14220", total)).toEqual({
      buyerSompi: total,
      ok: true,
      sellerSompi: 0n,
    });
    expect(splitSettlement("14220.00000001", total)).toMatchObject({ ok: false });
    expect(splitSettlement("-5", total)).toMatchObject({ ok: false });
  });
});
