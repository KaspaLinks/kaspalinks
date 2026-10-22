import { beforeEach, describe, expect, it, vi } from "vitest";

import { hashCreatorToken } from "@/lib/creator-auth";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  access: vi.fn((): null | object => ({ participantCaps: [8] })),
  enforceRateLimit: vi.fn(() => ({ allowed: true })),
  verifyAccountFreeTurnstile: vi.fn(async () => ({ ok: true })),
  writeAuditLog: vi.fn(async () => {}),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  prisma: { creator: { create: mocks.create } },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/giveaway-v6-creation", () => ({
  giveawayV6AccessFor: mocks.access,
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.enforceRateLimit,
  RateBuckets: { GUEST_CREATOR_CREATE: "creator.guest-create" },
}));
vi.mock("@/lib/turnstile", () => ({
  verifyAccountFreeTurnstile: mocks.verifyAccountFreeTurnstile,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://kaspalinks.test/api/creators/guest", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/creators/guest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockReturnValue({ participantCaps: [8] });
    mocks.verifyAccountFreeTurnstile.mockResolvedValue({ ok: true });
    mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "creator-guest",
      ...data,
    }));
  });

  it("creates a hidden guest workspace and returns its token once", async () => {
    const response = await POST(request({ turnstileToken: "human" }));
    const body = (await response.json()) as {
      creator: { username: string };
      creatorToken: string;
    };

    expect(response.status).toBe(201);
    expect(body.creator.username).toMatch(/^guest-[a-z2-9]{10}$/);
    expect(mocks.verifyAccountFreeTurnstile).toHaveBeenCalledWith(
      expect.objectContaining({ token: "human" }),
    );
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        accountKind: "GUEST",
        tokenHash: hashCreatorToken(body.creatorToken),
        username: body.creator.username,
      },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: "creator.guest_created" }),
    );
  });

  it("retries with a new name when the username is taken", async () => {
    mocks.create.mockRejectedValueOnce({ code: "P2002", meta: { target: ["username"] } });

    const response = await POST(request({}));

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("refuses a failed human check without creating anything", async () => {
    mocks.verifyAccountFreeTurnstile.mockResolvedValue({ kind: "invalid", ok: false } as never);

    const response = await POST(request({ turnstileToken: "bot" }));

    expect(response.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("stays closed while giveaways are not open to everyone", async () => {
    mocks.access.mockReturnValue(null);

    const response = await POST(request({}));

    expect(response.status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
