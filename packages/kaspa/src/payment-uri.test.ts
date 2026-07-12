import { describe, expect, it } from "vitest";

import { buildKaspaPaymentUri } from "./payment-uri";

const RECIPIENT_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

describe("buildKaspaPaymentUri", () => {
  it("builds a conservative payment URI with safely converted amount", () => {
    expect(
      buildKaspaPaymentUri({
        amountKas: "10.5",
        label: "Ada",
        message: "Thanks for the guide",
        recipientAddress: RECIPIENT_ADDRESS,
      }),
    ).toBe(`${RECIPIENT_ADDRESS}?amount=10.5&label=Ada&message=Thanks%20for%20the%20guide`);
  });

  it("supports sompi inputs and safely URL-encodes labels and messages", () => {
    expect(
      buildKaspaPaymentUri({
        amountSompi: "123456789",
        label: "Kaspa Actions / Demo",
        message: "verify address first",
        recipientAddress: RECIPIENT_ADDRESS,
      }),
    ).toBe(
      `${RECIPIENT_ADDRESS}?amount=1.23456789&label=Kaspa%20Actions%20%2F%20Demo&message=verify%20address%20first`,
    );
  });

  it("returns only the address when no optional fields are provided", () => {
    expect(buildKaspaPaymentUri({ recipientAddress: RECIPIENT_ADDRESS })).toBe(RECIPIENT_ADDRESS);
  });

  it("rejects invalid addresses, invalid amounts, and ambiguous amount inputs", () => {
    expect(() => buildKaspaPaymentUri({ recipientAddress: "kaspa:hallo" })).toThrow();
    expect(() =>
      buildKaspaPaymentUri({ amountKas: "0", recipientAddress: RECIPIENT_ADDRESS }),
    ).toThrow();
    expect(() =>
      buildKaspaPaymentUri({
        amountKas: "1",
        amountSompi: 100_000_000n,
        recipientAddress: RECIPIENT_ADDRESS,
      }),
    ).toThrow();
  });
});
