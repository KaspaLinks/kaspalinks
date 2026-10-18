import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actions: vi.fn(),
  claims: vi.fn(),
  connection: vi.fn(),
  groupBy: vi.fn(),
  requireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kaspa-actions/db")>()),
  prisma: {
    action: { findMany: mocks.actions },
    claimableLink: { findMany: mocks.claims },
    paymentRequest: { groupBy: mocks.groupBy },
    telegramConnection: { findUnique: mocks.connection },
  },
}));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.requireCreator }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: { TOCCATA_LAB_FUNDING_STATUS: "toccata.funding-status" },
}));

import { GET } from "./route";

const WALLET = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const createdAt = new Date("2026-10-18T10:00:00.000Z");

function get() {
  return GET(
    new Request("https://kaspalinks.com/api/telegram/links", {
      headers: { "x-telegram-mini-app-init-data": "x" },
    }),
  );
}

describe("GET /api/telegram/links", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://kaspalinks.com";
    mocks.requireCreator.mockResolvedValue({
      creator: {
        accountKind: "TELEGRAM_ONLY",
        defaultRecipientAddress: WALLET,
        id: "creator-tg",
        username: "tg_123",
      },
      ok: true,
    });
    mocks.connection.mockResolvedValue({ notificationsEnabled: true });
  });

  it("lists only this workspace's links with totals of confirmed payments", async () => {
    mocks.actions.mockResolvedValue([
      {
        amountSompi: null,
        createdAt,
        disabledAt: null,
        goalSompi: null,
        id: "action-1",
        publicId: "pub123",
        slug: null,
        title: "Coffee",
        type: "KASPA_TIP",
      },
    ]);
    mocks.claims.mockResolvedValue([
      {
        amountSompi: 500_200_000n,
        createdAt,
        feeSompi: 200_000n,
        linkKey: "lab-1",
        status: "claimed",
        title: "For Ada",
      },
    ]);
    mocks.groupBy.mockResolvedValue([
      { _count: { _all: 2 }, _sum: { amountSompi: 300_000_000n }, actionId: "action-1" },
    ]);

    const response = await get();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(mocks.actions).toHaveBeenCalledWith(
      expect.objectContaining({ where: { creatorId: "creator-tg", deletedAt: null } }),
    );
    expect(mocks.claims).toHaveBeenCalledWith(
      expect.objectContaining({ where: { creatorId: "creator-tg", deletedAt: null } }),
    );
    expect(body.wallet).toBe(WALLET);
    expect(body.alertsEnabled).toBe(true);
    expect(body.paymentLinks).toEqual([
      expect.objectContaining({
        confirmedCount: 2,
        publicId: "pub123",
        receivedKas: "3",
        type: "kaspa.tip",
        url: "https://kaspalinks.com/a/pub123",
      }),
    ]);
    expect(body.claimLinks).toEqual([
      expect.objectContaining({ amountKas: "5", linkKey: "lab-1", status: "claimed" }),
    ]);
  });

  it("skips the payment query when there are no links", async () => {
    mocks.actions.mockResolvedValue([]);
    mocks.claims.mockResolvedValue([]);

    const body = await (await get()).json();

    expect(mocks.groupBy).not.toHaveBeenCalled();
    expect(body).toMatchObject({ claimLinks: [], paymentLinks: [] });
  });

  it("refuses requests without Telegram authorization", async () => {
    mocks.requireCreator.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });

    expect((await get()).status).toBe(401);
    expect(mocks.actions).not.toHaveBeenCalled();
  });
});
