import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

function smokeRequest() {
  return new Request("https://kaspalinks.com/api/toccata-lab/pskt-smoke", {
    headers: {
      "x-forwarded-for": "203.0.113.21",
    },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/pskt-smoke", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await POST(smokeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "TOCCATA_LAB_DISABLED",
        message: "Toccata smoke probes are disabled on this deployment.",
      },
    });
  });

  it("runs a JSON-safe PSKT and covenant smoke test when enabled", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST(smokeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.prototype).toMatchObject({
      network: "mainnet",
      safeToFund: false,
      sdk: { ready: true, version: "2.0.1" },
      script: {
        opcode: "OpFalse",
        p2shAddress: "kaspa:pqp3wz3wwktm0dlrmpxq2wgazwdx9v2hu7rcdkxqstefmn6vzyf3gnczph2ag",
        redeemScriptHex: "00",
      },
    });
    expect(body.prototype.pskt).toMatchObject({
      hasInputs: false,
      hasSignatures: false,
      outputCount: 1,
      role: "Constructor",
    });
    expect(body.prototype.pskt.serialized).toContain('"state":"Constructor"');
    expect(body.prototype.pskt.serializedLength).toBe(body.prototype.pskt.serialized.length);
    expect(body.prototype.steps).toHaveLength(4);
    expect(body.warning).toContain("Do not fund");
    expect(JSON.stringify(body)).toContain("OP_FALSE");
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
