import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockReturnExpiredClaimable } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockReturnExpiredClaimable: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  prisma: { claimableLink: { findUnique: mockFindUnique } },
}));

vi.mock("@/lib/claimable-return", () => ({
  returnExpiredClaimable: mockReturnExpiredClaimable,
}));

vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: { CLAIMABLE_RETURN: "claimable.return" },
}));

import { POST } from "./route";

function call(linkKey: string) {
  return POST(new Request("https://example.com/api/claimable-links/x/return", { method: "POST" }), {
    params: Promise.resolve({ linkKey }),
  });
}

describe("POST /api/claimable-links/:linkKey/return", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    mockFindUnique.mockResolvedValue({ id: "link-1", linkKey: "lab-abc", scriptVersion: 2 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("only works for auto-return links", async () => {
    mockFindUnique.mockResolvedValue({ id: "link-1", linkKey: "lab-abc", scriptVersion: 1 });
    expect((await call("lab-abc")).status).toBe(404);
    expect(mockReturnExpiredClaimable).not.toHaveBeenCalled();
    expect((await call("../x")).status).toBe(400);
  });

  it("refuses before expiry", async () => {
    mockReturnExpiredClaimable.mockResolvedValue({ kind: "not_expired" });
    expect((await call("lab-abc")).status).toBe(409);
  });

  it("returns the broadcast transaction ids", async () => {
    mockReturnExpiredClaimable.mockResolvedValue({ kind: "returned", transactionIds: ["ab"] });
    const response = await call("lab-abc");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ returned: true, transactionIds: ["ab"] });
  });

  it("hides relay details behind a retry message", async () => {
    mockReturnExpiredClaimable.mockRejectedValue(new Error("internal relay detail"));
    const response = await call("lab-abc");
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("internal relay detail");
  });
});
