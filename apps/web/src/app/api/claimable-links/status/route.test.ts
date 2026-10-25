import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@kaspa-actions/db", () => ({ prisma: { claimableLink: { findMany: mocks.findMany } } }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: { CLAIMABLE_STATUS: "claimable.status" },
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("https://kaspalinks.test/api/claimable-links/status", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );
}

describe("POST /api/claimable-links/status", () => {
  beforeEach(() => mocks.findMany.mockReset());

  it("returns only the status of known, undeleted links", async () => {
    mocks.findMany.mockResolvedValue([
      { linkKey: "lab-open", status: "shared" },
      { linkKey: "lab-done", status: "claimed" },
    ]);

    const response = await post({ linkKeys: ["lab-open", "lab-done", "lab-gone"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      statuses: { "lab-done": "claimed", "lab-open": "shared" },
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      select: { linkKey: true, status: true },
      where: { deletedAt: null, linkKey: { in: ["lab-open", "lab-done", "lab-gone"] } },
    });
  });

  it("rejects malformed keys", async () => {
    expect((await post({ linkKeys: ["../etc"] })).status).toBe(400);
    expect((await post({ linkKeys: [] })).status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
