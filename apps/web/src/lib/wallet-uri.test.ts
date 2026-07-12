import { describe, expect, it } from "vitest";

import { buildWalletLaunchUri } from "./wallet-uri";

describe("buildWalletLaunchUri", () => {
  it("builds a conservative mobile wallet URI with only address and amount", () => {
    expect(
      buildWalletLaunchUri({
        amountKas: "10.5",
        recipientAddress: "kaspa:qexample",
      }),
    ).toBe("kaspa:qexample?amount=10.5");
  });

  it("falls back to address-only when no amount is available", () => {
    expect(buildWalletLaunchUri({ amountKas: null, recipientAddress: "kaspa:qexample" })).toBe(
      "kaspa:qexample",
    );
    expect(buildWalletLaunchUri({ amountKas: "   ", recipientAddress: "kaspa:qexample" })).toBe(
      "kaspa:qexample",
    );
  });
});
