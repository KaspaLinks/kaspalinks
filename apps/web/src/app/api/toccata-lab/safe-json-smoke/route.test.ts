import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

function smokeRequest() {
  return new Request("https://kaspalinks.com/api/toccata-lab/safe-json-smoke", {
    headers: {
      "x-forwarded-for": "203.0.113.22",
    },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/safe-json-smoke", () => {
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

  it("runs a decode-only SafeJSON transaction smoke test when enabled", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST(smokeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.prototype).toMatchObject({
      amountSompi: "20000000",
      format: "safe-json-transaction",
      network: "mainnet",
      safeToFund: false,
      sdk: { ready: true, version: "2.0.1" },
      script: {
        opcode: "OpFalse",
        p2shAddress: "kaspa:pqp3wz3wwktm0dlrmpxq2wgazwdx9v2hu7rcdkxqstefmn6vzyf3gnczph2ag",
        redeemScriptHex: "00",
      },
      walletSignable: false,
    });
    expect(body.prototype.transaction).toMatchObject({
      hasInputs: false,
      hasSignatures: false,
      inputCount: 0,
      outputCount: 1,
      outputValueSompi: "20000000",
      txVersion: 0,
    });
    expect(body.prototype.transaction.safeJson).toContain('"outputs"');
    expect(body.prototype.transaction.safeJson).toContain('"value":"20000000"');
    expect(body.prototype.transaction.safeJsonLength).toBe(
      body.prototype.transaction.safeJson.length,
    );
    expect(body.prototype.steps.map((step: { name: string }) => step.name)).toEqual([
      "Script hash derivation",
      "SafeJSON serialization",
      "SafeJSON round trip",
      "Covenant output in SafeJSON",
    ]);
    // The covenant result reports the SDK's actual SafeJSON covenant support;
    // whatever it says, it must agree with itself.
    expect(typeof body.prototype.covenant.supported).toBe("boolean");
    expect(body.prototype.covenant.supported).toBe(
      body.prototype.covenant.safeJsonIncludesBinding &&
        body.prototype.covenant.roundTripPreserved,
    );
    expect(body.warning).toContain("decode-only");
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
