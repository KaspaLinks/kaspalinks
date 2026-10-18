import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockVerify } = vi.hoisted(() => {
  const mockPrisma = {
    $transaction: vi.fn(),
    action: { create: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof mockPrisma) => unknown) => callback(mockPrisma),
  );
  return {
    mockPrisma,
    mockVerify: vi.fn(async (): Promise<{ kind?: string; ok: boolean }> => ({ ok: true })),
  };
});

vi.mock("@kaspa-actions/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kaspa-actions/db")>()),
  prisma: mockPrisma,
}));

vi.mock("@/lib/turnstile", () => ({ verifyAccountFreeTurnstile: mockVerify }));

vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: {
    ACCOUNT_FREE_LINK_CREATE: "account-free-link.create",
    ACCOUNT_FREE_LINK_DAILY: "account-free-link.daily",
  },
}));

import { POST } from "./route";

const RECIPIENT = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const MANAGE_TOKEN_HASH = "a".repeat(64);

function request(payload: unknown) {
  return new Request("https://kaspalinks.com/api/actions", {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    method: "POST",
  });
}

const body = {
  manageTokenHash: MANAGE_TOKEN_HASH,
  recipientAddress: RECIPIENT,
  source: "pay-success",
  title: "Buy me a coffee",
  turnstileToken: "token",
  type: "kaspa.tip",
};

describe("POST /api/actions", () => {
  beforeEach(() => {
    vi.stubEnv("PAYMENT_LINKS_ANONYMOUS_ENABLED", "true");
    mockPrisma.action.create.mockImplementation(async ({ data }: { data: object }) => ({
      agentCommandKey: null,
      amountSompi: null,
      createdAt: new Date("2026-10-18T10:00:00.000Z"),
      deletedAt: null,
      description: null,
      disabledAt: null,
      expiresAt: null,
      goalAutoClose: false,
      goalSompi: null,
      id: "action-1",
      invoicePaidAt: null,
      message: null,
      noteRequired: false,
      publicId: "pub123",
      updatedAt: new Date("2026-10-18T10:00:00.000Z"),
      version: "v1",
      ...data,
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is not found while the switch is off", async () => {
    vi.stubEnv("PAYMENT_LINKS_ANONYMOUS_ENABLED", "false");
    const response = await POST(request(body));
    expect(response.status).toBe(404);
    expect(mockPrisma.action.create).not.toHaveBeenCalled();
  });

  it("creates a link without creator, slug or profile listing", async () => {
    const response = await POST(request({ ...body, hiddenFromProfile: false, slug: "mine" }));
    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.action).toMatchObject({ publicId: "pub123", sharePath: "/a/pub123" });
    expect(JSON.stringify(json)).not.toContain(MANAGE_TOKEN_HASH);

    const { data } = mockPrisma.action.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      createdWithoutAccount: true,
      creatorId: null,
      hiddenFromProfile: true,
      manageTokenHash: MANAGE_TOKEN_HASH,
      slug: null,
      source: "pay-success",
      type: "KASPA_TIP",
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorType: "PUBLIC",
        event: "action.created_account_free",
      }),
    });
  });

  it("drops an unknown source label instead of failing", async () => {
    const response = await POST(request({ ...body, source: "someone@example.com" }));
    expect(response.status).toBe(201);
    const { data } = mockPrisma.action.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.source).toBeNull();
  });

  it("requires the hash of a manage token", async () => {
    for (const manageTokenHash of [undefined, "abc", "A".repeat(64)]) {
      const response = await POST(request({ ...body, manageTokenHash }));
      expect(response.status).toBe(400);
    }
    expect(mockPrisma.action.create).not.toHaveBeenCalled();
  });

  it("enforces the fixed amount and goal rules of each type", async () => {
    expect((await POST(request({ ...body, type: "kaspa.invoice" }))).status).toBe(400);
    expect((await POST(request({ ...body, type: "kaspa.goal" }))).status).toBe(400);
    expect(mockPrisma.action.create).not.toHaveBeenCalled();
  });

  it("stops when the human check fails", async () => {
    mockVerify.mockResolvedValueOnce({ kind: "invalid", ok: false });
    const response = await POST(request(body));
    expect(response.status).toBe(403);
    expect(mockPrisma.action.create).not.toHaveBeenCalled();
  });
});
