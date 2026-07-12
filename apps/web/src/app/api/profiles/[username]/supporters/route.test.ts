import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    creator: {
      findUnique: vi.fn(),
    },
    paymentRequest: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  PaymentRequestStatus: {
    CONFIRMED: "CONFIRMED",
  },
  prisma: mockPrisma,
}));

import { encodeSupporterWallCursor } from "@/lib/supporter-wall";

import { GET } from "./route";

function request(path = "/api/profiles/ada/supporters?limit=2") {
  return new Request(`https://kaspalinks.com${path}`);
}

function context(username = "ada") {
  return { params: Promise.resolve({ username }) };
}

function supporterEntry(id: string, confirmedAt: Date) {
  return {
    action: {
      publicId: `public-${id}`,
      slug: `support-${id}`,
      title: `Support ${id}`,
      type: "KASPA_DONATION",
    },
    amountSompi: 200_000_000n,
    confirmedAt,
    id,
    supporterMessage: "Awesome work",
    supporterName: "Mark",
  };
}

describe("GET /api/profiles/:username/supporters", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPrisma.creator.findUnique.mockResolvedValue({ id: "creator-1", username: "ada" });
  });

  it("returns a paginated public supporter wall page", async () => {
    const first = supporterEntry("payment-3", new Date("2026-06-04T12:00:00.000Z"));
    const second = supporterEntry("payment-2", new Date("2026-06-04T11:00:00.000Z"));
    const extra = supporterEntry("payment-1", new Date("2026-06-04T10:00:00.000Z"));
    mockPrisma.paymentRequest.findMany.mockResolvedValue([first, second, extra]);

    const response = await GET(request(), context("Ada"));

    expect(response.status).toBe(200);
    expect(mockPrisma.creator.findUnique).toHaveBeenCalledWith({
      select: { id: true, username: true },
      where: { username: "ada" },
    });
    expect(mockPrisma.paymentRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
        take: 3,
        where: expect.objectContaining({
          action: {
            creatorId: "creator-1",
            deletedAt: null,
            hiddenFromProfile: false,
          },
          confirmedAt: { not: null },
          status: "CONFIRMED",
          supporterHiddenAt: null,
          supporterPublic: true,
        }),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      hasMore: true,
      nextCursor: encodeSupporterWallCursor(second),
      supporters: [
        {
          actionHref: "/u/ada/support-payment-3",
          actionTitle: "Support payment-3",
          amountKas: "2",
          dateLabel: "Jun 4, 2026",
          id: "payment-3",
          message: "Awesome work",
          supporterName: "Mark",
          typeLabel: "Donation",
        },
        {
          actionHref: "/u/ada/support-payment-2",
          actionTitle: "Support payment-2",
          amountKas: "2",
          dateLabel: "Jun 4, 2026",
          id: "payment-2",
          message: "Awesome work",
          supporterName: "Mark",
          typeLabel: "Donation",
        },
      ],
    });
  });

  it("applies a cursor for subsequent pages", async () => {
    const cursor = encodeSupporterWallCursor({
      confirmedAt: new Date("2026-06-04T11:00:00.000Z"),
      id: "payment-2",
    });
    mockPrisma.paymentRequest.findMany.mockResolvedValue([]);

    const response = await GET(
      request(`/api/profiles/ada/supporters?cursor=${encodeURIComponent(cursor)}`),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 21,
        where: expect.objectContaining({
          OR: [
            { confirmedAt: { lt: new Date("2026-06-04T11:00:00.000Z") } },
            { confirmedAt: new Date("2026-06-04T11:00:00.000Z"), id: { lt: "payment-2" } },
          ],
        }),
      }),
    );
  });

  it("rejects invalid cursors", async () => {
    const response = await GET(request("/api/profiles/ada/supporters?cursor=not-a-cursor"), context());

    expect(response.status).toBe(400);
    expect(mockPrisma.creator.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.paymentRequest.findMany).not.toHaveBeenCalled();
  });

  it("returns not found for missing profiles", async () => {
    mockPrisma.creator.findUnique.mockResolvedValue(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(mockPrisma.paymentRequest.findMany).not.toHaveBeenCalled();
  });
});
