import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCreator } = vi.hoisted(() => {
  const mockPrisma = {
    $transaction: vi.fn(),
    action: { updateMany: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  mockPrisma.$transaction.mockImplementation(
    async (callback: (client: typeof mockPrisma) => unknown) => callback(mockPrisma),
  );
  return { mockPrisma, mockRequireCreator: vi.fn() };
});

vi.mock("@kaspa-actions/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kaspa-actions/db")>()),
  prisma: mockPrisma,
}));

vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));

import { hashManageToken } from "@/lib/account-free-links";

import { POST } from "./route";

const GOOD = "G".repeat(43);

function request(body: unknown) {
  return new Request("https://kaspalinks.com/api/creator/actions/adopt", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/creator/actions/adopt", () => {
  beforeEach(() => {
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1", username: "ada" },
      ipHash: "ip",
      ok: true,
    });
    mockPrisma.action.updateMany.mockImplementation(
      async ({ where }: { where: { manageTokenHash: string } }) => ({
        count: where.manageTokenHash === hashManageToken(GOOD) ? 1 : 0,
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("moves only links whose manage token matches, into the signed-in account", async () => {
    const response = await POST(
      request({
        links: [
          { manageToken: GOOD, publicId: "one" },
          { manageToken: "B".repeat(43), publicId: "two" },
          { manageToken: "not-a-token", publicId: "three" },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adopted: ["one"] });
    expect(mockPrisma.action.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.action.updateMany).toHaveBeenCalledWith({
      data: { creatorId: "creator-1", manageTokenHash: null },
      where: {
        creatorId: null,
        deletedAt: null,
        manageTokenHash: hashManageToken(GOOD),
        publicId: "one",
      },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("needs a signed-in creator", async () => {
    mockRequireCreator.mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    const response = await POST(request({ links: [{ manageToken: GOOD, publicId: "one" }] }));
    expect(response.status).toBe(401);
    expect(mockPrisma.action.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized list", async () => {
    expect((await POST(request({ links: [] }))).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, index) => ({
      manageToken: GOOD,
      publicId: `p${index}`,
    }));
    expect((await POST(request({ links: many }))).status).toBe(400);
  });
});
