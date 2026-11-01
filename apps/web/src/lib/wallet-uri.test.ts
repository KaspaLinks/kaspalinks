import { describe, expect, it } from "vitest";

import { buildWalletLaunchUri, parseWalletLaunchUri, walletBridgePath } from "./wallet-uri";

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

const ADDRESS = "kaspa:qypq8vh4xtmkcq7ajnhuyrl3s2z8kd94hrxqvhkxuyu5xzqzx34yshcq8ahy9";

describe("parseWalletLaunchUri", () => {
  it("reads the address and amount of a payment URI", () => {
    expect(parseWalletLaunchUri(`${ADDRESS}?amount=5.002`)).toEqual({
      address: ADDRESS,
      amountKas: "5.002",
      uri: `${ADDRESS}?amount=5.002`,
    });
    expect(parseWalletLaunchUri(ADDRESS)).toEqual({
      address: ADDRESS,
      amountKas: null,
      uri: ADDRESS,
    });
  });

  it("accepts giveaway funding URIs and hands on only address and amount", () => {
    expect(
      parseWalletLaunchUri(
        `${ADDRESS}?amount=101.73&label=Kaspa%20Links%20Giveaway&message=Community%20drop`,
      ),
    ).toEqual({ address: ADDRESS, amountKas: "101.73", uri: `${ADDRESS}?amount=101.73` });
  });

  it("rejects anything that is not a plain kaspa: payment URI", () => {
    for (const uri of [
      "javascript:alert(1)",
      "https://example.com",
      `${ADDRESS}?amount=5&redirect=x`,
      `${ADDRESS}?amount=5&amount=6`,
      `${ADDRESS}?amount=-5`,
      "kaspa:short",
      "",
    ]) {
      expect(parseWalletLaunchUri(uri)).toBeNull();
    }
  });

  it("round-trips through the bridge page fragment", () => {
    const uri = `${ADDRESS}?amount=101.73`;
    const fragment = walletBridgePath(uri, 1).split("#")[1] ?? "";
    expect(walletBridgePath(uri, 1)).toMatch(/^\/open-wallet\?at=1#/);
    expect(walletBridgePath(uri, 1)).not.toBe(walletBridgePath(uri, 2));
    expect(parseWalletLaunchUri(decodeURIComponent(fragment))?.uri).toBe(uri);
  });
});
