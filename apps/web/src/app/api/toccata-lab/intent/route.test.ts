import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

const MAINNET_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

function jsonRequest(body: unknown) {
  return new Request("https://kaspalinks.com/api/toccata-lab/intent", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/intent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await POST(
      jsonRequest({ amountKas: "1", recipientAddress: MAINNET_ADDRESS }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TOCCATA_LAB_DISABLED",
        message: "Claimable links are disabled on this deployment.",
      },
    });
  });

  it("creates a mainnet intent when explicitly enabled", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST(
      jsonRequest({
        amountKas: "1",
        message: "Mini test",
        recipientAddress: MAINNET_ADDRESS,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.intent).toMatchObject({
      amountKas: "1",
      amountSompi: "100000000",
      network: "mainnet",
      recipientAddress: MAINNET_ADDRESS,
    });
    expect(body.intent.uri).toContain("amount=1");
    expect(body.intent.sdk).toMatchObject({ ready: true, version: "2.0.1" });
  });

  it("accepts claimable-link amounts above 1 KAS", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST(
      jsonRequest({ amountKas: "25.12345678", recipientAddress: MAINNET_ADDRESS }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.intent).toMatchObject({
      amountKas: "25.12345678",
      amountSompi: "2512345678",
    });
  });

  it("rejects claimable-link amounts below the reliable wallet minimum", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST(
      jsonRequest({ amountKas: "0.01", recipientAddress: MAINNET_ADDRESS }),
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
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
