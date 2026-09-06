import { Prisma, type PrismaClient } from "@kaspa-actions/db";
import { ApplicationError } from "./errors.ts";

export async function setGiveawayResultSubscription(
  prisma: PrismaClient,
  input: { publicId: string; telegramUserId: string; telegramChatId: string; enabled: boolean },
  now = new Date(),
) {
  // Only the authenticated private-chat adapter calls this tool. A watch never
  // proves entry, wallet ownership, or entitlement to the prize.
  if (input.telegramUserId !== input.telegramChatId) {
    throw new ApplicationError("PRIVATE_CHAT_REQUIRED", "Use your private bot chat.", 403);
  }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`giveaway-watch:${input.telegramUserId}`}, 0))`,
    );
    const giveaway = await tx.giveaway.findUnique({
      where: { publicId: input.publicId },
      select: { id: true, title: true },
    });
    if (!giveaway) throw new ApplicationError("GIVEAWAY_NOT_FOUND", "Giveaway not found.", 404);
    const where = {
      giveawayId_telegramUserId: { giveawayId: giveaway.id, telegramUserId: input.telegramUserId },
    };
    const current = await tx.telegramGiveawaySubscription.findUnique({ where });
    if (!input.enabled) {
      await tx.telegramGiveawaySubscription.updateMany({
        where: { giveawayId: giveaway.id, telegramUserId: input.telegramUserId },
        data: { revokedAt: now },
      });
      return { title: giveaway.title, enabled: false };
    }
    if (!current || current.revokedAt) {
      const count = await tx.telegramGiveawaySubscription.count({
        where: { telegramUserId: input.telegramUserId, revokedAt: null, resultQueuedAt: null },
      });
      if (count >= 50)
        throw new ApplicationError(
          "WATCH_LIMIT",
          "You already follow 50 pending giveaways. Turn off a reminder first.",
          429,
        );
    }
    if (current?.revokedAt && current.resultQueuedAt) {
      // Explicit re-enabling may retry an unsent result suppressed after opt-out.
      // Never replay a result that Telegram already accepted and we recorded as sent.
      await tx.telegramOutbox.updateMany({
        where: {
          subscriptionId: current.id,
          sentAt: null,
          status: "DEAD",
          kind: "giveaway.result",
        },
        data: {
          status: "PENDING",
          availableAt: now,
          attempts: 0,
          lastErrorCode: null,
          lockedAt: null,
        },
      });
    }
    await tx.telegramGiveawaySubscription.upsert({
      where,
      create: {
        giveawayId: giveaway.id,
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
      },
      // A delivered result is never reset by pressing an old button again.
      update: { revokedAt: null, telegramChatId: input.telegramChatId },
    });
    return { title: giveaway.title, enabled: true };
  });
}

export async function stopGiveawayResultSubscriptions(
  prisma: PrismaClient,
  telegramUserId: string,
  now = new Date(),
) {
  return prisma.telegramGiveawaySubscription.updateMany({
    where: { telegramUserId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function queueGiveawayResults(prisma: PrismaClient, now = new Date()) {
  const subscriptions = await prisma.telegramGiveawaySubscription.findMany({
    where: {
      revokedAt: null,
      resultQueuedAt: null,
      giveaway: { status: { in: ["DRAWN", "NO_ENTRIES", "CANCELLED"] } },
    },
    include: { giveaway: { select: { publicId: true, title: true, status: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const subscription of subscriptions) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.telegramGiveawaySubscription.updateMany({
        where: { id: subscription.id, revokedAt: null, resultQueuedAt: null },
        data: { resultQueuedAt: now },
      });
      if (claimed.count !== 1) return;
      await tx.telegramOutbox.upsert({
        where: { dedupeKey: `giveaway-result:${subscription.id}` },
        update: {},
        create: {
          subscriptionId: subscription.id,
          dedupeKey: `giveaway-result:${subscription.id}`,
          kind: "giveaway.result",
          payload: {
            publicId: subscription.giveaway.publicId,
            title: subscription.giveaway.title,
            status: subscription.giveaway.status,
          },
        },
      });
    });
  }
}
