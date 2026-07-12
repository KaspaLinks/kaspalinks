import { afterEach, describe, expect, it, vi } from "vitest";

import { resetKasUsdPriceCacheForTests } from "@/lib/kas-price";

import { GET, POST } from "./route";

describe("GET /api/price/kas-usd", () => {
  afterEach(() => {
    resetKasUsdPriceCacheForTests();
    vi.restoreAllMocks();
  });

  it("returns a cached server-side KAS/USD price payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ kaspa: { usd: 0.034 } }))),
    );

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.price).toMatchObject({
      approximate: true,
      kasUsd: "0.034",
      source: "coingecko",
      stale: false,
    });
  });

  it("uses the standard API error shape when price lookup is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRICE_UNAVAILABLE",
        message: "KAS/USD price is temporarily unavailable.",
      },
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
