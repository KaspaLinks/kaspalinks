import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnforceRateLimit, mockPrisma, mockRequireCreator, mockWriteAuditLog } = vi.hoisted(
  () => {
    const prismaActions = {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    };
    const prismaPaymentRequests = {
      count: vi.fn(),
      deleteMany: vi.fn(),
    };
    const prismaCreator = {
      delete: vi.fn(),
      update: vi.fn(),
    };
    const prismaClaimableLinks = {
      findFirst: vi.fn(),
    };
    return {
      mockEnforceRateLimit: vi.fn(),
      mockPrisma: {
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
          // Hand the same mocked surface to the callback so the test can
          // observe per-table delete calls without simulating a real tx.
          return cb({
            action: prismaActions,
            creator: prismaCreator,
            paymentRequest: prismaPaymentRequests,
          });
        }),
        action: prismaActions,
        claimableLink: prismaClaimableLinks,
        creator: prismaCreator,
        paymentRequest: prismaPaymentRequests,
      },
      mockRequireCreator: vi.fn(),
      mockWriteAuditLog: vi.fn(async () => {}),
    };
  },
);

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  Prisma: { DbNull: "DbNull" },
  prisma: mockPrisma,
}));

vi.mock("@/lib/creator-guard", () => ({
  requireCreator: mockRequireCreator,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mockEnforceRateLimit,
  RateBuckets: {
    CREATOR_PROFILE_DELETE: "creator.profile.delete",
    CREATOR_PROFILE_UPDATE: "creator.profile.update",
  },
}));

import { DELETE, PATCH, POST } from "./route";

function request(body: unknown) {
  return new Request("https://example.com/api/creators/me", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "DELETE",
  });
}

describe("DELETE /api/creators/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1", username: "ada" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockEnforceRateLimit.mockReturnValue({ allowed: true, result: {} });
    mockWriteAuditLog.mockResolvedValue(undefined);
    mockPrisma.claimableLink.findFirst.mockResolvedValue(null);
  });

  it("hard-deletes the creator and all owned actions + payment requests", async () => {
    mockPrisma.action.findMany.mockResolvedValue([{ id: "action-1" }, { id: "action-2" }]);
    mockPrisma.paymentRequest.count.mockResolvedValue(5);
    mockPrisma.paymentRequest.deleteMany.mockResolvedValue({ count: 5 });
    mockPrisma.action.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.creator.delete.mockResolvedValue({ id: "creator-1" });

    const response = await DELETE(request({ confirmUsername: "ada" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedActionCount: 2,
      deletedPaymentRequestCount: 5,
      ok: true,
    });

    // Leaf-out delete order: payment requests, then actions, then creator.
    expect(mockPrisma.paymentRequest.deleteMany).toHaveBeenCalledWith({
      where: { actionId: { in: ["action-1", "action-2"] } },
    });
    expect(mockPrisma.action.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["action-1", "action-2"] } },
    });
    expect(mockPrisma.creator.delete).toHaveBeenCalledWith({ where: { id: "creator-1" } });

    // Audit log captures the deletion before the row is wiped.
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        creatorId: "creator-1",
        event: "creator.deleted",
        metadata: expect.objectContaining({
          deletedActionCount: 2,
          deletedPaymentRequestCount: 5,
          username: "ada",
        }),
      }),
    );
  });

  it("skips DB writes for a creator that owns nothing", async () => {
    mockPrisma.action.findMany.mockResolvedValue([]);
    // count + deleteMany shouldn't get called when there are no actions.
    mockPrisma.creator.delete.mockResolvedValue({ id: "creator-1" });

    const response = await DELETE(request({ confirmUsername: "ada" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deletedActionCount: 0,
      deletedPaymentRequestCount: 0,
      ok: true,
    });
    expect(mockPrisma.paymentRequest.count).not.toHaveBeenCalled();
    expect(mockPrisma.paymentRequest.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.action.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.creator.delete).toHaveBeenCalledWith({ where: { id: "creator-1" } });
  });

  it("blocks profile deletion while an open claimable link exists", async () => {
    mockPrisma.claimableLink.findFirst.mockResolvedValue({
      id: "claimable-1",
      status: "refundable",
    });

    const response = await DELETE(request({ confirmUsername: "ada" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_STATE",
        message:
          "Close or remove every open claimable link before deleting your profile. An open claimable link may still hold KAS.",
      },
    });
    expect(mockPrisma.creator.delete).not.toHaveBeenCalled();
    expect(mockPrisma.action.findMany).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        creatorId: "creator-1",
        event: "creator.delete_blocked_open_claimable",
        metadata: { claimableStatus: "refundable" },
      }),
    );
  });

  it("rejects deletion when the confirmation username does not match", async () => {
    mockPrisma.action.findMany.mockResolvedValue([]);

    const response = await DELETE(request({ confirmUsername: "someone-else" }));

    expect(response.status).toBe(400);
    expect(mockPrisma.creator.delete).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        creatorId: "creator-1",
        event: "creator.delete_mismatch",
      }),
    );
  });

  it("case-folds the confirmation comparison so 'ADA' still matches 'ada'", async () => {
    mockPrisma.action.findMany.mockResolvedValue([]);
    mockPrisma.creator.delete.mockResolvedValue({ id: "creator-1" });

    const response = await DELETE(request({ confirmUsername: "  ADA  " }));

    expect(response.status).toBe(200);
    expect(mockPrisma.creator.delete).toHaveBeenCalled();
  });

  it("returns 400 when the body is not JSON", async () => {
    const response = await DELETE(request("not-json"));
    expect(response.status).toBe(400);
    expect(mockPrisma.creator.delete).not.toHaveBeenCalled();
  });

  it("returns 400 when confirmUsername is missing from the body", async () => {
    const response = await DELETE(request({}));
    expect(response.status).toBe(400);
    expect(mockPrisma.creator.delete).not.toHaveBeenCalled();
  });

  it("propagates auth failure from the guard", async () => {
    mockRequireCreator.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "CREATOR_TOKEN_INVALID" } }), {
        status: 401,
      }),
    });

    const response = await DELETE(request({ confirmUsername: "ada" }));
    expect(response.status).toBe(401);
    expect(mockPrisma.creator.delete).not.toHaveBeenCalled();
  });

  it("rate-limits repeated profile deletion attempts", async () => {
    mockEnforceRateLimit.mockReturnValue({
      allowed: false,
      response: new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), {
        status: 429,
      }),
    });

    const response = await DELETE(request({ confirmUsername: "ada" }));

    expect(response.status).toBe(429);
    expect(mockPrisma.action.findMany).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        creatorId: "creator-1",
        event: "creator.profile_delete_rate_limited",
        metadata: { bucket: "creator.profile.delete" },
      }),
    );
  });

  it("returns 405 with allow header for unsupported methods", async () => {
    const response = POST();
    expect(response.status).toBe(405);
    // Allow header lists every method the route handles. Profile updates
    // landed PATCH next to DELETE; if you add another method (PUT, etc.)
    // remember to bump this list.
    expect(response.headers.get("allow")).toBe("DELETE, PATCH");
  });
});

function patchRequest(body: unknown) {
  return new Request("https://example.com/api/creators/me", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

describe("PATCH /api/creators/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: {
        bio: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        displayName: null,
        id: "creator-1",
        socialLinks: null,
        tipActionId: null,
        username: "ada",
      },
      ipHash: "ip-hash",
      ok: true,
    });
    mockEnforceRateLimit.mockReturnValue({ allowed: true, result: {} });
    mockWriteAuditLog.mockResolvedValue(undefined);
  });

  it("persists bio + displayName + tipActionId when caller owns the target Action", async () => {
    mockPrisma.action.findFirst.mockResolvedValue({ id: "action-1" });
    mockPrisma.creator.update.mockResolvedValue({
      bio: "trail runner",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      displayName: "Ada",
      id: "creator-1",
      socialLinks: null,
      tipActionId: "action-1",
      username: "ada",
    });

    const response = await PATCH(
      patchRequest({ bio: "trail runner", displayName: "Ada", tipActionId: "action-1" }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.creator).toMatchObject({
      bio: "trail runner",
      displayName: "Ada",
      tipActionId: "action-1",
      username: "ada",
    });

    // Ownership lookup is scoped to creatorId + deletedAt:null so an
    // attacker can't promote someone else's Action to their profile.
    expect(mockPrisma.action.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { creatorId: "creator-1", deletedAt: null, id: "action-1" },
    });
    expect(mockPrisma.creator.update).toHaveBeenCalledWith({
      data: { bio: "trail runner", displayName: "Ada", tipActionId: "action-1" },
      where: { id: "creator-1" },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        creatorId: "creator-1",
        event: "creator.profile_updated",
        metadata: { fields: ["bio", "displayName", "tipActionId"] },
      }),
    );
  });

  it("clears tipActionId when explicitly null without an ownership query", async () => {
    mockPrisma.creator.update.mockResolvedValue({
      bio: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      displayName: null,
      id: "creator-1",
      socialLinks: null,
      tipActionId: null,
      username: "ada",
    });

    const response = await PATCH(patchRequest({ tipActionId: null }));
    expect(response.status).toBe(200);
    expect(mockPrisma.action.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.creator.update).toHaveBeenCalledWith({
      data: { tipActionId: null },
      where: { id: "creator-1" },
    });
  });

  it("rejects tipActionId that does not belong to the caller", async () => {
    // findFirst returns null because the Action belongs to a different
    // creator (or doesn't exist). We must never promote it.
    mockPrisma.action.findFirst.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ tipActionId: "someone-elses-action" }));
    expect(response.status).toBe(400);
    expect(mockPrisma.creator.update).not.toHaveBeenCalled();
  });

  it("persists whitelisted social links and normalizes blank entries", async () => {
    mockPrisma.creator.update.mockResolvedValue({
      bio: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      displayName: null,
      id: "creator-1",
      socialLinks: {
        website: "https://example.com/",
        x: "https://x.com/ada",
      },
      tipActionId: null,
      username: "ada",
    });

    const response = await PATCH(
      patchRequest({
        socialLinks: {
          discord: "   ",
          website: " https://example.com ",
          x: "https://x.com/ada",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      creator: {
        socialLinks: {
          website: "https://example.com/",
          x: "https://x.com/ada",
        },
      },
    });
    expect(mockPrisma.creator.update).toHaveBeenCalledWith({
      data: {
        socialLinks: {
          website: "https://example.com/",
          x: "https://x.com/ada",
        },
      },
      where: { id: "creator-1" },
    });
  });

  it("clears social links with a database null when every social field is blank", async () => {
    mockPrisma.creator.update.mockResolvedValue({
      bio: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      displayName: null,
      id: "creator-1",
      socialLinks: null,
      tipActionId: null,
      username: "ada",
    });

    const response = await PATCH(patchRequest({ socialLinks: { website: " " } }));

    expect(response.status).toBe(200);
    expect(mockPrisma.creator.update).toHaveBeenCalledWith({
      data: { socialLinks: "DbNull" },
      where: { id: "creator-1" },
    });
  });

  it("returns 400 when the body is not JSON", async () => {
    const response = await PATCH(patchRequest("not-json"));
    expect(response.status).toBe(400);
    expect(mockPrisma.creator.update).not.toHaveBeenCalled();
  });

  it("returns 400 when no updatable field is supplied", async () => {
    const response = await PATCH(patchRequest({}));
    expect(response.status).toBe(400);
    expect(mockPrisma.creator.update).not.toHaveBeenCalled();
  });

  it("propagates auth failure from the guard", async () => {
    mockRequireCreator.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: { code: "CREATOR_TOKEN_INVALID" } }), {
        status: 401,
      }),
    });
    const response = await PATCH(patchRequest({ bio: "trail runner" }));
    expect(response.status).toBe(401);
    expect(mockPrisma.creator.update).not.toHaveBeenCalled();
  });

  it("rate-limits repeated profile update attempts", async () => {
    mockEnforceRateLimit.mockReturnValue({
      allowed: false,
      response: new Response(JSON.stringify({ error: { code: "RATE_LIMITED" } }), {
        status: 429,
      }),
    });
    const response = await PATCH(patchRequest({ bio: "trail runner" }));
    expect(response.status).toBe(429);
    expect(mockPrisma.creator.update).not.toHaveBeenCalled();
  });
});
