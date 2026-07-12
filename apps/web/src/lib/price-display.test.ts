import { describe, expect, it } from "vitest";

import { formatApproxUsdMeta, formatApproxUsdValue } from "./price-display";

describe("price display helpers", () => {
  it("formats approximate USD values from KAS strings", () => {
    expect(formatApproxUsdValue("1", { kasUsd: "0.0347763" })).toBe("≈ $0.035 USD");
    expect(formatApproxUsdValue("10", { kasUsd: "0.0347763" })).toBe("≈ $0.348 USD");
    expect(formatApproxUsdValue("10,5", { kasUsd: "0.0347763" })).toBe("≈ $0.365 USD");
    expect(formatApproxUsdValue("100", { kasUsd: "0.0347763" })).toBe("≈ $3.48 USD");
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
  });
});
