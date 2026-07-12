import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { POST } from "./route";

const LINKS = [
  {
    linkPublicKey: "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
    refundPublicKey: "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
  },
  {
    linkPublicKey: "1d14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72",
    refundPublicKey: "2730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c",
  },
];

function request(body: unknown) {
  return new Request("https://kaspalinks.com/api/toccata-lab/batch-scripts", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.200" },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/batch-scripts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("requires the separate batch-lab feature flag", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    const response = await POST(request({ links: LINKS, refundLockTime: "123456789" }));
    expect(response.status).toBe(403);
  });

  it("derives one script per public-key pair without receiving secrets", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_BATCH_LAB_ENABLED", "true");
    const response = await POST(request({ links: LINKS, refundLockTime: "123456789" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      scripts: [{ refundLockTime: "123456789" }, { refundLockTime: "123456789" }],
    });
  });
});
