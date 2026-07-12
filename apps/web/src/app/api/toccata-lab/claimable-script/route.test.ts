import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

function claimableScriptRequest(body: unknown) {
  return new Request("https://kaspalinks.com/api/toccata-lab/claimable-script", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.21",
    },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/claimable-script", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await POST(
      claimableScriptRequest({
        linkPublicKey: "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
        refundLockTime: "123456789",
        refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("derives a claimable funding address from public keys", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST(
      claimableScriptRequest({
        linkPublicKey: "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
        refundLockTime: "123456789",
        refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      script: {
        fundingAddress: "kaspa:prclnra75kmgsm3hpt0cw692vg5p96udzfqnysjaywm8fw5v54et2jf8khjwf",
        refundLockTime: "123456789",
      },
    });
  });

  it("validates public key input", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST(
      claimableScriptRequest({
        linkPublicKey: "bad",
        refundLockTime: "123456789",
        refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_BODY",
      },
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
