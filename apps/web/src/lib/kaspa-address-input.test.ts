import { describe, expect, it } from "vitest";

import { normalizeKaspaAddressInput, thrownMessage } from "./kaspa-address-input";

describe("Kaspa address input", () => {
  it("undoes phone capitalization and stray spaces", () => {
    expect(normalizeKaspaAddressInput(" Kaspa:QPAUQ ")).toBe("kaspa:qpauq");
  });

  it("keeps the text of strings the Kaspa SDK throws", () => {
    expect(thrownMessage("The address has an invalid prefix Kaspa", "x")).toBe(
      "The address has an invalid prefix Kaspa",
    );
    expect(thrownMessage(new Error("boom"), "x")).toBe("boom");
    expect(thrownMessage(new Error(""), "fallback")).toBe("fallback");
    expect(thrownMessage({ code: 1 }, "fallback")).toBe("fallback");
  });
});
