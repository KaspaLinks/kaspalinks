import type { PrismaClient } from "@kaspa-actions/db";

// Telegram bot usage for the operator stats page. Everything here is counted
// from data the bot already keeps: chats, update timestamps with a coarse
// label, Mini App page views, links created through Telegram and messages sent.

const DAY_MS = 24 * 60 * 60 * 1000;

export type TelegramBotStats = {
  activeChats: { last24h: number; last30d: number; last7d: number };
  chats: {
    blocked: number;
    new7d: number;
    total: number;
    withAccount: number;
    withoutAccount: number;
  };
  created: {
    claimLinks: number;
    claimLinks7d: number;
    paymentLinks: number;
    paymentLinks7d: number;
  };
  interactions: {
    last24h: number;
    last30d: number;
    last7d: number;
    since: Date | null;
    total: number;
  };
  messagesSent: { byKind: Array<{ count: number; kind: string }>; last7d: number; total: number };
  miniAppViews: { last30d: number; last7d: number };
  topActions30d: Array<{ count: number; label: string }>;
};

type StatsPrisma = Pick<
  PrismaClient,
  | "action"
  | "auditLog"
  | "claimableLink"
  | "operatorPageView"
  | "telegramConnection"
  | "telegramOutbox"
  | "telegramUpdate"
>;

export async function loadTelegramBotStats(
  prisma: StatsPrisma,
  now: Date = new Date(),
): Promise<TelegramBotStats> {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const [
    chatsTotal,
    chatsWithoutAccount,
    chatsBlocked,
    chatsNew7d,
    active24h,
    active7d,
    active30d,
    updatesTotal,
    updates24h,
    updates7d,
    updates30d,
    firstUpdate,
    labelGroups,
    miniApp7d,
    miniApp30d,
    accountFreeLinks,
    accountFreeLinks7d,
    accountLinks,
    accountLinks7d,
    claimLinks,
    claimLinks7d,
    sentTotal,
    sent7d,
    sentByKind,
  ] = await Promise.all([
    prisma.telegramConnection.count(),
    prisma.telegramConnection.count({ where: { creator: { accountKind: "TELEGRAM_ONLY" } } }),
    prisma.telegramConnection.count({ where: { blockedAt: { not: null } } }),
    prisma.telegramConnection.count({ where: { createdAt: { gte: ago(7) } } }),
    prisma.telegramConnection.count({ where: { lastActiveAt: { gte: ago(1) } } }),
    prisma.telegramConnection.count({ where: { lastActiveAt: { gte: ago(7) } } }),
    prisma.telegramConnection.count({ where: { lastActiveAt: { gte: ago(30) } } }),
    prisma.telegramUpdate.count(),
    prisma.telegramUpdate.count({ where: { receivedAt: { gte: ago(1) } } }),
    prisma.telegramUpdate.count({ where: { receivedAt: { gte: ago(7) } } }),
    prisma.telegramUpdate.count({ where: { receivedAt: { gte: ago(30) } } }),
    prisma.telegramUpdate.findFirst({
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    }),
    prisma.telegramUpdate.groupBy({
      _count: { _all: true },
      by: ["label"],
      where: { label: { not: null }, receivedAt: { gte: ago(30) } },
    }),
    prisma.operatorPageView.count({
      where: { isBot: false, path: { startsWith: "/telegram" }, seenAt: { gte: ago(7) } },
    }),
    prisma.operatorPageView.count({
      where: { isBot: false, path: { startsWith: "/telegram" }, seenAt: { gte: ago(30) } },
    }),
    // Telegram-only chats create account-free links tagged with the bot as source;
    // connected accounts log the channel on the creation audit entry.
    prisma.action.count({ where: { source: "telegram-bot" } }),
    prisma.action.count({ where: { createdAt: { gte: ago(7) }, source: "telegram-bot" } }),
    prisma.auditLog.count({
      where: {
        event: "creator.action_created",
        metadata: { equals: "telegram", path: ["channel"] },
      },
    }),
    prisma.auditLog.count({
      where: {
        createdAt: { gte: ago(7) },
        event: "creator.action_created",
        metadata: { equals: "telegram", path: ["channel"] },
      },
    }),
    prisma.claimableLink.count({ where: { source: "telegram-bot" } }),
    prisma.claimableLink.count({ where: { createdAt: { gte: ago(7) }, source: "telegram-bot" } }),
    prisma.telegramOutbox.count({ where: { status: "SENT" } }),
    prisma.telegramOutbox.count({ where: { sentAt: { gte: ago(7) }, status: "SENT" } }),
    prisma.telegramOutbox.groupBy({
      _count: { _all: true },
      by: ["kind"],
      where: { status: "SENT" },
    }),
  ]);

  return {
    activeChats: { last24h: active24h, last30d: active30d, last7d: active7d },
    chats: {
      blocked: chatsBlocked,
      new7d: chatsNew7d,
      total: chatsTotal,
      withAccount: chatsTotal - chatsWithoutAccount,
      withoutAccount: chatsWithoutAccount,
    },
    created: {
      claimLinks,
      claimLinks7d,
      paymentLinks: accountFreeLinks + accountLinks,
      paymentLinks7d: accountFreeLinks7d + accountLinks7d,
    },
    interactions: {
      last24h: updates24h,
      last30d: updates30d,
      last7d: updates7d,
      since: firstUpdate?.receivedAt ?? null,
      total: updatesTotal,
    },
    messagesSent: {
      byKind: sentByKind
        .map((row) => ({ count: row._count._all, kind: row.kind }))
        .sort((left, right) => right.count - left.count),
      last7d: sent7d,
      total: sentTotal,
    },
    miniAppViews: { last30d: miniApp30d, last7d: miniApp7d },
    topActions30d: labelGroups
      .map((row) => ({ count: row._count._all, label: row.label ?? "" }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
  };
}
