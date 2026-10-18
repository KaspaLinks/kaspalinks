import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCreator, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: { claimableLink: { updateMany: vi.fn() } },
  mockRequireCreator: vi.fn(),
  mockWriteAuditLog: vi.fn(async () => {}),
}));

vi.mock("@kaspa-actions/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kaspa-actions/db")>()),
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mockWriteAuditLog }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));

import { hashManageToken } from "@/lib/account-free-links";

import { POST } from "./route";

const GOOD = "C".repeat(43);

describe("POST /api/creator/claimable-links/adopt", () => {
  beforeEach(() => {
    mockRequireCreator.mockResolvedValue({ creator: { id: "creator-1" }, ipHash: "ip", ok: true });
    mockPrisma.claimableLink.updateMany.mockImplementation(
      async ({ where }: { where: { manageTokenHash: string } }) => ({
        count: where.manageTokenHash === hashManageToken(GOOD) ? 1 : 0,
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("moves account-free claim links whose token matches", async () => {
    const response = await POST(
      new Request("https://kaspalinks.com/api/creator/claimable-links/adopt", {
        body: JSON.stringify({
          links: [
            { linkKey: "lab-one", manageToken: GOOD },
            { linkKey: "lab-two", manageToken: "D".repeat(43) },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(await response.json()).toEqual({ adopted: ["lab-one"] });
    expect(mockPrisma.claimableLink.updateMany).toHaveBeenCalledWith({
      data: { creatorId: "creator-1", manageTokenHash: null },
      where: {
        creatorId: null,
        deletedAt: null,
        linkKey: "lab-one",
        manageTokenHash: hashManageToken(GOOD),
      },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ event: "claimable_link.adopted_account_free" }),
    );
  });
});
