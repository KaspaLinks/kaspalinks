import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: {
    creator: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  mockWriteAuditLog: vi.fn(async () => {}),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: { CREATOR_SIGNUP: "creator.signup" },
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://example.com/api/creators", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/creators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CREATOR_SIGNUP_ENABLED", "true");
    mockPrisma.creator.findUnique.mockResolvedValue(null);
    mockPrisma.creator.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        bio: null,
        createdAt: new Date("2026-10-03T12:00:00.000Z"),
        displayName: data.displayName ?? null,
        id: "creator-1",
        signupSource: data.signupSource,
        socialLinks: null,
        tipActionId: null,
        username: data.username,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores an allowlisted signup source without returning it", async () => {
    const response = await POST(request({ signupSource: "pay-success", username: "ada" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockPrisma.creator.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ signupSource: "pay-success", username: "ada" }),
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        event: "creator.created",
        metadata: { signupSource: "pay-success", username: "ada" },
      }),
    );
    expect(body.creator).not.toHaveProperty("signupSource");
    expect(JSON.stringify(body)).not.toContain("pay-success");
  });

  it("drops unknown sources and still creates the creator", async () => {
    const response = await POST(request({ signupSource: "<script>", username: "ada" }));

    expect(response.status).toBe(201);
    expect(mockPrisma.creator.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ signupSource: null }),
    });
  });

  it("stores null for direct signups", async () => {
    const response = await POST(request({ username: "ada" }));

    expect(response.status).toBe(201);
    expect(mockPrisma.creator.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ signupSource: null }),
    });
  });
});
