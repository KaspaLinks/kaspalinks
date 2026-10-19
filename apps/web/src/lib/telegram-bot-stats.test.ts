import { describe, expect, it, vi } from "vitest";

import { loadTelegramBotStats } from "./telegram-bot-stats";

function prismaWith() {
  const count = (value: number) => vi.fn(async () => value);
  return {
    action: {
      count: vi.fn(async (args: { where: { createdAt?: unknown } }) =>
        args.where.createdAt ? 1 : 3,
      ),
    },
    auditLog: {
      count: vi.fn(async (args: { where: { createdAt?: unknown } }) =>
        args.where.createdAt ? 0 : 2,
      ),
    },
    claimableLink: {
      count: vi.fn(async (args: { where: { createdAt?: unknown } }) =>
        args.where.createdAt ? 2 : 4,
      ),
    },
    operatorPageView: { count: count(5) },
    telegramConnection: { count: count(6) },
    telegramOutbox: {
      count: count(7),
      groupBy: vi.fn(async () => [
        { _count: { _all: 1 }, kind: "giveaway.result" },
        { _count: { _all: 4 }, kind: "claimable.status" },
      ]),
    },
    telegramUpdate: {
      count: count(9),
      findFirst: vi.fn(async () => ({ receivedAt: new Date("2026-08-30T19:15:22Z") })),
      groupBy: vi.fn(async () => [
        { _count: { _all: 2 }, label: "/help" },
        { _count: { _all: 5 }, label: "/claim" },
      ]),
    },
  };
}

describe("loadTelegramBotStats", () => {
  it("adds links from chats with and without an account and sorts the breakdowns", async () => {
    const prisma = prismaWith();
    const stats = await loadTelegramBotStats(
      prisma as unknown as Parameters<typeof loadTelegramBotStats>[0],
      new Date("2026-10-19T12:00:00Z"),
    );

    expect(stats.created).toEqual({
      claimLinks: 4,
      claimLinks7d: 2,
      paymentLinks: 5,
      paymentLinks7d: 1,
    });
    expect(stats.topActions30d).toEqual([
      { count: 5, label: "/claim" },
      { count: 2, label: "/help" },
    ]);
    expect(stats.messagesSent.byKind[0]).toEqual({ count: 4, kind: "claimable.status" });
    expect(stats.interactions.since?.toISOString()).toBe("2026-08-30T19:15:22.000Z");
  });

  it("only counts human Mini App page views and labelled updates of the last 30 days", async () => {
    const prisma = prismaWith();
    await loadTelegramBotStats(
      prisma as unknown as Parameters<typeof loadTelegramBotStats>[0],
      new Date("2026-10-19T12:00:00Z"),
    );

    expect(prisma.operatorPageView.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ isBot: false, path: { startsWith: "/telegram" } }),
    });
    expect(prisma.telegramUpdate.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { label: { not: null }, receivedAt: { gte: new Date("2026-09-19T12:00:00Z") } },
      }),
    );
  });
});
