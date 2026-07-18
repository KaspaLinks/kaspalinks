import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    action: { count: vi.fn() },
    claimableLink: { count: vi.fn() },
    creator: { count: vi.fn() },
  },
}));

vi.mock("@kaspa-actions/db", () => ({ prisma: mockPrisma }));
vi.mock("next/cache", () => ({
  unstable_cache: (operation: () => unknown) => operation,
}));

import { GET } from "./route";

describe("GET /api/public/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.action.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2);
    mockPrisma.claimableLink.count.mockResolvedValueOnce(5).mockResolvedValueOnce(1);
    mockPrisma.creator.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([
        { kind: "all_time", payments: 4n, sompi: 800_000_000n },
        { kind: "last_7d", payments: 1n, sompi: 200_000_000n },
      ])
      .mockResolvedValueOnce([{ count: 4n, type: "kaspa.claimable" }])
      .mockResolvedValueOnce([]);
  });

  it("keeps created-link totals historical while active creators require undeleted links", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        activeCreators: 3,
        confirmedPayments: 4,
        totalKasReceived: "8",
        totalLinks: 15,
        totalLinksDelta7d: 3,
      }),
    );
    expect(mockPrisma.action.count).toHaveBeenNthCalledWith(1, {
      where: { network: "MAINNET" },
    });
    expect(mockPrisma.claimableLink.count).toHaveBeenNthCalledWith(1, {
      where: { network: "MAINNET" },
    });
    expect(mockPrisma.creator.count).toHaveBeenNthCalledWith(1, {
      where: {
        OR: [
          { actions: { some: { deletedAt: null, network: "MAINNET" } } },
          { claimableLinks: { some: { deletedAt: null, network: "MAINNET" } } },
        ],
      },
    });
  });
});
