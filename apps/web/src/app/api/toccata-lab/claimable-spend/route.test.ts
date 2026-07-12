import { afterEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

import { GET, POST } from "./route";

describe("POST /api/toccata-lab/claimable-spend", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("is disabled by default", async () => {
    const response = await POST();

    expect(response.status).toBe(403);
  });

  it("refuses server-side spend signing when the lab is enabled", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_STATE",
        message: expect.stringContaining("browser signer"),
      },
    });
  });

  it("does not read or echo submitted spend codes", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");

    const response = await POST();

    expect(response.status).toBe(409);
    const text = await response.text();
    expect(text).toContain("INVALID_STATE");
    expect(text).not.toContain("not-a-secret-key");
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
