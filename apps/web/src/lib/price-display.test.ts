import { describe, expect, it } from "vitest";

import {
  fiatToKas,
  formatApproxFiatValue,
  formatApproxUsdMeta,
  formatApproxUsdValue,
  kasToFiat,
} from "./price-display";

describe("price display helpers", () => {
  it("formats approximate USD values from KAS strings", () => {
    expect(formatApproxUsdValue("1", { kasUsd: "0.0347763" })).toBe("≈ $0.035 USD");
    expect(formatApproxUsdValue("10", { kasUsd: "0.0347763" })).toBe("≈ $0.348 USD");
    expect(formatApproxUsdValue("10,5", { kasUsd: "0.0347763" })).toBe("≈ $0.365 USD");
    expect(formatApproxUsdValue("100", { kasUsd: "0.0347763" })).toBe("≈ $3.48 USD");
  });

  it("adds the EUR value when the price includes it", () => {
    const price = { kasEur: "0.0298", kasUsd: "0.0347763" };
    expect(formatApproxFiatValue("1", price)).toBe("≈ $0.035 · €0.030");
    expect(formatApproxFiatValue("100", price)).toBe("≈ $3.48 · €2.98");
    expect(formatApproxFiatValue("100000", price)).toBe("≈ $3,477.63 · €2,980.00");
    expect(formatApproxFiatValue("100", { kasEur: null, kasUsd: "0.0347763" })).toBe("≈ $3.48 USD");
  });

  it("hides malformed or unavailable estimates", () => {
    expect(formatApproxUsdValue("", { kasUsd: "0.0347763" })).toBeNull();
    expect(formatApproxUsdValue("abc", { kasUsd: "0.0347763" })).toBeNull();
    expect(formatApproxUsdValue("0.123456789", { kasUsd: "0.0347763" })).toBeNull();
    expect(formatApproxUsdValue("10", null)).toBeNull();
  });

  it("labels stale price estimates clearly", () => {
    expect(formatApproxUsdMeta({ kasUsd: "0.03" })).toBe("Approx. USD value");
    expect(formatApproxUsdMeta({ kasUsd: "0.03", stale: true })).toBe(
      "Approx. USD value from latest cached KAS price",
    );
    expect(formatApproxUsdMeta({ kasEur: "0.025", kasUsd: "0.03" })).toBe("Approx. value");
  });

  it("converts a USD or EUR amount to KAS, rounded to 2 decimals", () => {
    expect(fiatToKas("10", "0.0316")).toBe("316.46");
    expect(fiatToKas("10,50", "0.0316")).toBe("332.28");
    expect(fiatToKas("3", "0.03")).toBe("100");
    expect(fiatToKas("1000", "0.0316")).toBe("31645.57");
    expect(fiatToKas(".5", "0.05")).toBe("10");
  });

  it("refuses fiat amounts it cannot convert", () => {
    expect(fiatToKas("", "0.03")).toBeNull();
    expect(fiatToKas("0", "0.03")).toBeNull();
    expect(fiatToKas("1.2.3", "0.03")).toBeNull();
    expect(fiatToKas("abc", "0.03")).toBeNull();
    expect(fiatToKas("10", null)).toBeNull();
    expect(fiatToKas("10", "0")).toBeNull();
    // Too small to round to a cent of KAS.
    expect(fiatToKas("0.0001", "0.03")).toBeNull();
  });

  it("shows a KAS amount in USD or EUR for the input field", () => {
    expect(kasToFiat("100", "0.0316")).toBe("3.16");
    expect(kasToFiat("316.46", "0.0316")).toBe("10.00");
    expect(kasToFiat("", "0.0316")).toBeNull();
    expect(kasToFiat("10", undefined)).toBeNull();
  });
});
