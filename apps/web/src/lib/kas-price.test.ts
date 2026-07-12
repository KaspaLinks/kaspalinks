import { afterEach, describe, expect, it, vi } from "vitest";

import { getKasUsdPrice, resetKasUsdPriceCacheForTests } from "./kas-price";

const NOW = new Date("2026-05-20T12:00:00.000Z");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("getKasUsdPrice", () => {
  afterEach(() => {
    resetKasUsdPriceCacheForTests();
    vi.restoreAllMocks();
  });

  it("fetches and serializes the KAS/USD price without exposing floats in JSON callers", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ kaspa: { last_updated_at: 1_779_301_084, usd: 0.0347763 } }),
    ) as unknown as typeof fetch;

    const price = await getKasUsdPrice({ fetchImpl, now: NOW });

    expect(price).toEqual({
      approximate: true,
      fetchedAt: "2026-05-20T12:00:00.000Z",
      kasUsd: "0.0347763",
      lastUpdatedAt: "2026-05-20T18:18:04.000Z",
      source: "coingecko",
      stale: false,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("uses the in-memory cache inside the TTL", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ kaspa: { usd: 0.03 } }),
    ) as unknown as typeof fetch;

    await getKasUsdPrice({ fetchImpl, now: NOW });
    await getKasUsdPrice({ fetchImpl, now: new Date("2026-05-20T12:04:59.000Z") });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns a stale cached price when refreshing fails", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ kaspa: { usd: 0.03 } }))
      .mockRejectedValueOnce(new Error("network down")) as unknown as typeof fetch;

    await getKasUsdPrice({ fetchImpl, now: NOW });
    const stale = await getKasUsdPrice({
      fetchImpl,
      now: new Date("2026-05-20T12:06:00.000Z"),
    });

    expect(stale.kasUsd).toBe("0.03");
    expect(stale.stale).toBe(true);
  });

  it("rejects invalid upstream responses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ kaspa: { usd: 0 } }),
    ) as unknown as typeof fetch;

    await expect(getKasUsdPrice({ fetchImpl, now: NOW })).rejects.toThrow("valid USD price");
  });
});
