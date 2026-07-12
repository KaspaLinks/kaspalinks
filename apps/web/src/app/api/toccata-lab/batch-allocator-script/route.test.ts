import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { POST } from "./route";

const request = (body: unknown) =>
  new Request("https://kaspalinks.com/api/toccata-lab/batch-allocator-script", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.201" },
    method: "POST",
  });

const BODY = {
  activationPublicKey: "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
  outputs: [
    { amountSompi: "100000000", scriptPublicKeyHex: "0000aa" },
    { amountSompi: "100000000", scriptPublicKeyHex: "0000bb" },
  ],
  refundLockTime: "123456789",
  refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
};

describe("POST /api/toccata-lab/batch-allocator-script", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("requires the separate private batch-lab flag", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    const response = await POST(request(BODY));
    expect(response.status).toBe(403);
  });

  it("constructs a contract from public, committed output terms only", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_BATCH_LAB_ENABLED", "true");
    const response = await POST(request(BODY));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      allocator: { outputCount: 2, refundLockTime: "123456789" },
    });
  });
});
