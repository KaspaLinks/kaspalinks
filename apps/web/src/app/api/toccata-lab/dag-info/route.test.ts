import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

function dagInfoRequest() {
  return new Request("https://kaspalinks.com/api/toccata-lab/dag-info", {
    headers: { "x-forwarded-for": "203.0.113.15" },
  });
}

describe("GET /api/toccata-lab/dag-info", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await GET(dagInfoRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TOCCATA_LAB_DISABLED",
        message: "Claimable links are disabled on this deployment.",
      },
    });
  });

  it("returns the current mainnet virtual DAA score", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          networkName: "kaspa-mainnet",
          pastMedianTime: "1783170335272",
          virtualDaaScore: "477506357",
        }),
        { status: 200 },
      ),
    );

    const response = await GET(dagInfoRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      network: "mainnet",
      pastMedianTime: "1783170335272",
      virtualDaaScore: "477506357",
    });
  });

  it("rejects unexpected upstream responses", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ networkName: "kaspa-testnet-10" }), { status: 200 }),
    );

    const response = await GET(dagInfoRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "SERVER_ERROR",
      },
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
