import { describe, expect, it } from "vitest";

import { PRICE_INPUT_MAX_AGE_MS, parseKasUsdPriceResponse } from "./use-kas-usd-price";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

describe("parseKasUsdPriceResponse", () => {
  it("reads both rates and dates the price by CoinGecko's update time", () => {
    const price = parseKasUsdPriceResponse(
      {
        price: {
          fetchedAt: "2026-10-20T11:59:00.000Z",
          kasEur: "0.0316",
          kasUsd: "0.0354",
          lastUpdatedAt: "2026-10-20T11:58:30.000Z",
          stale: false,
        },
      },
      NOW,
    );

    expect(price).toEqual({
      kasEur: "0.0316",
      kasUsd: "0.0354",
      old: false,
      pricedAtMs: Date.parse("2026-10-20T11:58:30.000Z"),
      stale: false,
    });
  });

  it("marks a price older than the input limit as old", () => {
    const pricedAt = new Date(NOW - PRICE_INPUT_MAX_AGE_MS - 60_000).toISOString();
    const price = parseKasUsdPriceResponse(
      { price: { fetchedAt: pricedAt, kasUsd: "0.0354", stale: true } },
      NOW,
    );

    expect(price?.old).toBe(true);
    expect(price?.kasEur).toBeNull();
    expect(price?.stale).toBe(true);
  });

  it("ignores responses without a USD rate", () => {
    expect(parseKasUsdPriceResponse({}, NOW)).toBeNull();
    expect(parseKasUsdPriceResponse({ price: { kasUsd: 0.03 } }, NOW)).toBeNull();
    expect(parseKasUsdPriceResponse(null, NOW)).toBeNull();
  });
});
