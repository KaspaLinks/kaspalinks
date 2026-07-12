import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

const MAINNET_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

function qrUrl(params: Record<string, string>) {
  return `https://kaspalinks.com/api/toccata-lab/qr?${new URLSearchParams(params).toString()}`;
}

describe("GET /api/toccata-lab/qr", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await GET(
      new Request(qrUrl({ amountKas: "1", recipientAddress: MAINNET_ADDRESS })),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TOCCATA_LAB_DISABLED",
        message: "Claimable links are disabled on this deployment.",
      },
    });
  });

  it("renders an SVG QR for a mainnet intent", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await GET(
      new Request(
        qrUrl({
          amountKas: "1",
          format: "svg",
          label: "Kaspa Links claimable",
          message: "Mini test",
          recipientAddress: MAINNET_ADDRESS,
        }),
        {
          headers: { "x-forwarded-for": "203.0.113.11" },
        },
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(body).toContain("<svg");
  });

  it("rejects non-kaspa recipient addresses", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await GET(
      new Request(qrUrl({ amountKas: "1", recipientAddress: "https://example.com" }), {
        headers: { "x-forwarded-for": "203.0.113.12" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
        message: "Address is not a valid Kaspa address.",
      },
    });
  });

  it("accepts amounts above 1 KAS", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await GET(
      new Request(qrUrl({ amountKas: "999", format: "svg", recipientAddress: MAINNET_ADDRESS }), {
        headers: { "x-forwarded-for": "203.0.113.13" },
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("<svg");
  });

  it("rejects amounts below the reliable wallet minimum", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await GET(
      new Request(qrUrl({ amountKas: "0.01", recipientAddress: MAINNET_ADDRESS }), {
        headers: { "x-forwarded-for": "203.0.113.14" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
        message: expect.stringContaining("at least 1 KAS"),
      },
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
