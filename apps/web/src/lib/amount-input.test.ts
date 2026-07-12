import { describe, expect, it } from "vitest";

import { normalizeLocalizedKasAmountInput } from "./amount-input";

describe("normalizeLocalizedKasAmountInput", () => {
  it("accepts mobile decimal commas while keeping canonical dot decimals", () => {
    expect(normalizeLocalizedKasAmountInput("10,5")).toBe("10.5");
    expect(normalizeLocalizedKasAmountInput("0,00000001")).toBe("0.00000001");
    expect(normalizeLocalizedKasAmountInput("10.5")).toBe("10.5");
  });

  it("leaves malformed multi-separator input for normal validation to reject", () => {
    expect(normalizeLocalizedKasAmountInput("1,2,3")).toBe("1.2.3");
  });
});
