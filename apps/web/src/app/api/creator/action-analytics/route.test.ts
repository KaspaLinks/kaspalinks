import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCreator, mockSyncOperatorPageViewsFromAccessLogs } = vi.hoisted(
  () => ({
    mockPrisma: {
      action: {
        findMany: vi.fn(),
      },
      operatorPageView: {
        groupBy: vi.fn(),
      },
      paymentRequest: {
        groupBy: vi.fn(),
      },
    },
    mockRequireCreator: vi.fn(),
    mockSyncOperatorPageViewsFromAccessLogs: vi.fn(),
  }),
);

vi.mock("@kaspa-actions/db", () => ({
  PaymentRequestStatus: {
    CONFIRMED: "CONFIRMED",
    EXPIRED: "EXPIRED",
    FAILED: "FAILED",
    PENDING: "PENDING",
  },
  prisma: mockPrisma,
}));

vi.mock("@/lib/creator-guard", () => ({
  requireCreator: mockRequireCreator,
}));

vi.mock("@/lib/operator-stats", () => ({
  syncOperatorPageViewsFromAccessLogs: mockSyncOperatorPageViewsFromAccessLogs,
}));

import { GET, POST } from "./route";

function request() {
  return new Request("https://example.com/api/creator/action-analytics");
}

describe("GET /api/creator/action-analytics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: {
        id: "creator-1",
        tipActionId: "action-tip",
        username: "ada",
      },
      ipHash: "ip-hash",
      ok: true,
    });
    mockSyncOperatorPageViewsFromAccessLogs.mockResolvedValue({
      filesRead: 1,
      linesParsed: 12,
      logDir: "/var/log/caddy",
      parseErrors: 0,
      storage: "database",
    });
  });

  it("aggregates legacy, human, and profile quick-tip views per creator Action", async () => {
    mockPrisma.action.findMany.mockResolvedValue([
      {
        disabledAt: null,
        id: "action-tip",
        publicId: "pub-tip",
        slug: "tip",
      },
      {
        disabledAt: null,
        id: "action-invoice",
        publicId: "pub-invoice",
        slug: "invoice",
      },
    ]);
    mockPrisma.operatorPageView.groupBy
      .mockResolvedValueOnce([
        { _count: { _all: 1 }, path: "/u/ada" },
        { _count: { _all: 1 }, path: "/u/ada/tip" },
        { _count: { _all: 1 }, path: "/a/pub-tip" },
        { _count: { _all: 1 }, path: "/u/ada/invoice" },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 1 }, path: "/u/ada" },
        { _count: { _all: 1 }, path: "/u/ada/tip" },
        { _count: { _all: 1 }, path: "/u/ada/invoice" },
      ])
      .mockResolvedValueOnce([
        { path: "/u/ada", visitorDayHash: "visitor-a-today" },
        { path: "/u/ada/tip", visitorDayHash: "visitor-b-today" },
        { path: "/a/pub-tip", visitorDayHash: "visitor-a-old" },
        { path: "/u/ada/invoice", visitorDayHash: "visitor-c-today" },
      ])
      .mockResolvedValueOnce([
        { path: "/u/ada", visitorDayHash: "visitor-a-today" },
        { path: "/u/ada/tip", visitorDayHash: "visitor-b-today" },
        { path: "/u/ada/invoice", visitorDayHash: "visitor-c-today" },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 1 }, path: "/u/ada", referrer: "https://x.com/someone/status/1" },
        { _count: { _all: 1 }, path: "/u/ada/tip", referrer: "https://x.com/someone/status/2" },
        { _count: { _all: 1 }, path: "/a/pub-tip", referrer: "-" },
        {
          _count: { _all: 1 },
          path: "/u/ada/invoice",
          referrer: "https://telegram.org/",
        },
      ]);
    mockPrisma.paymentRequest.groupBy
      .mockResolvedValueOnce([
        { _count: { _all: 1 }, actionId: "action-tip", status: "PENDING" },
        { _count: { _all: 1 }, actionId: "action-tip", status: "CONFIRMED" },
        { _count: { _all: 1 }, actionId: "action-invoice", status: "CONFIRMED" },
      ])
      .mockResolvedValueOnce([
        { _count: { _all: 1 }, actionId: "action-tip", status: "PENDING" },
        { _count: { _all: 1 }, actionId: "action-tip", status: "CONFIRMED" },
      ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mockSyncOperatorPageViewsFromAccessLogs).toHaveBeenCalledWith(mockPrisma);
    expect(mockPrisma.operatorPageView.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isBot: false,
          path: {
            in: expect.arrayContaining([
              "/a/pub-tip",
              "/u/ada/tip",
              "/u/ada",
              "/a/pub-invoice",
              "/u/ada/invoice",
            ]),
          },
          seenAt: {
            gte: expect.any(Date),
          },
        }),
      }),
    );

    const body = await response.json();
    expect(body).toEqual({
      analytics: {
        "pub-invoice": {
          confirmedPayments: { last7d: 0, total: 1 },
          conversion: {
            confirmedFromViewRate: 1,
            requestFromViewRate: 1,
          },
          paymentRequests: { last7d: 0, total: 1 },
          referrers: [{ count: 1, label: "telegram.org" }],
          uniqueVisitors: { last7d: 1, total: 1 },
          views: { last7d: 1, total: 1 },
        },
        "pub-tip": {
          confirmedPayments: { last7d: 1, total: 1 },
          conversion: {
            confirmedFromViewRate: 0.3333,
            requestFromViewRate: 0.6667,
          },
          paymentRequests: { last7d: 2, total: 2 },
          referrers: [
            { count: 2, label: "x.com" },
            { count: 1, label: "Direct" },
          ],
          uniqueVisitors: { last7d: 2, total: 3 },
          views: { last7d: 2, total: 3 },
        },
      },
      source: {
        computedAt: expect.any(String),
        filesRead: 1,
        linesParsed: 12,
        storage: "database",
        windowDays: 90,
      },
    });
  });

  it("does not attribute profile views to a disabled quick-tip Action", async () => {
    mockPrisma.action.findMany.mockResolvedValue([
      {
        disabledAt: new Date("2026-01-01T00:00:00.000Z"),
        id: "action-tip",
        publicId: "pub-tip",
        slug: "tip",
      },
    ]);
    mockPrisma.operatorPageView.groupBy.mockResolvedValue([]);
    mockPrisma.paymentRequest.groupBy.mockResolvedValue([]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mockPrisma.operatorPageView.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          path: {
            in: expect.not.arrayContaining(["/u/ada"]),
          },
        }),
      }),
    );
  });

  it("returns an empty analytics object when the creator has no links", async () => {
    mockPrisma.action.findMany.mockResolvedValue([]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      analytics: {},
      source: {
        computedAt: expect.any(String),
        filesRead: 1,
        linesParsed: 12,
        storage: "database",
        windowDays: 90,
      },
    });
    expect(mockPrisma.operatorPageView.groupBy).not.toHaveBeenCalled();
    expect(mockPrisma.paymentRequest.groupBy).not.toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
