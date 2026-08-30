import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCreator, mockSyncOperatorPageViewsFromAccessLogs } = vi.hoisted(
  () => ({
    mockPrisma: {
      giveaway: { findMany: vi.fn() },
      operatorPageView: { groupBy: vi.fn() },
    },
    mockRequireCreator: vi.fn(),
    mockSyncOperatorPageViewsFromAccessLogs: vi.fn(),
  }),
);

vi.mock("@kaspa-actions/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));
vi.mock("@/lib/operator-stats", () => ({
  syncOperatorPageViewsFromAccessLogs: mockSyncOperatorPageViewsFromAccessLogs,
}));

import { GET, POST } from "./route";

describe("GET /api/creator/giveaway-analytics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireCreator.mockResolvedValue({ creator: { id: "creator-1" }, ok: true });
    mockSyncOperatorPageViewsFromAccessLogs.mockResolvedValue({
      filesRead: 1,
      linesParsed: 9,
      storage: "database",
    });
  });

  it("aggregates human views, daily visitors, and referrers per giveaway", async () => {
    mockPrisma.giveaway.findMany.mockResolvedValue([
      { publicId: "giveaway-1" },
      { publicId: "giveaway-2" },
    ]);
    mockPrisma.operatorPageView.groupBy
      .mockResolvedValueOnce([
        {
          _count: { _all: 6 },
          path: "/toccata-lab/giveaway/giveaway-1",
        },
      ])
      .mockResolvedValueOnce([
        {
          _count: { _all: 4 },
          path: "/toccata-lab/giveaway/giveaway-1",
        },
      ])
      .mockResolvedValueOnce([
        {
          path: "/toccata-lab/giveaway/giveaway-1",
          visitorDayHash: "visitor-a",
        },
        {
          path: "/toccata-lab/giveaway/giveaway-1",
          visitorDayHash: "visitor-b",
        },
      ])
      .mockResolvedValueOnce([
        {
          path: "/toccata-lab/giveaway/giveaway-1",
          visitorDayHash: "visitor-a",
        },
      ])
      .mockResolvedValueOnce([
        {
          _count: { _all: 5 },
          path: "/toccata-lab/giveaway/giveaway-1",
          referrer: "https://x.com/KaspaLinks/status/1",
        },
        {
          _count: { _all: 1 },
          path: "/toccata-lab/giveaway/giveaway-1",
          referrer: "-",
        },
      ]);

    const response = await GET(
      new Request("https://kaspalinks.com/api/creator/giveaway-analytics"),
    );

    expect(response.status).toBe(200);
    expect(mockSyncOperatorPageViewsFromAccessLogs).toHaveBeenCalledWith(mockPrisma);
    expect(mockPrisma.operatorPageView.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isBot: false,
          path: {
            in: ["/toccata-lab/giveaway/giveaway-1", "/toccata-lab/giveaway/giveaway-2"],
          },
          status: { gte: 200, lt: 400 },
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      analytics: {
        "giveaway-1": {
          referrers: [
            { count: 5, label: "x.com" },
            { count: 1, label: "Direct" },
          ],
          uniqueVisitors: { last7d: 1, total: 2 },
          views: { last7d: 4, total: 6 },
        },
        "giveaway-2": {
          referrers: [],
          uniqueVisitors: { last7d: 0, total: 0 },
          views: { last7d: 0, total: 0 },
        },
      },
      source: {
        computedAt: expect.any(String),
        filesRead: 1,
        linesParsed: 9,
        storage: "database",
        windowDays: 90,
      },
    });
  });

  it("returns an empty map without querying page views when no giveaways exist", async () => {
    mockPrisma.giveaway.findMany.mockResolvedValue([]);

    const response = await GET(
      new Request("https://kaspalinks.com/api/creator/giveaway-analytics"),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.operatorPageView.groupBy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ analytics: {} });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
