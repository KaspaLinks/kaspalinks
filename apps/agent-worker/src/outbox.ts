import {
  groupGiveawayMessage,
  groupPostedMessage,
  groupPostQuestion,
  TelegramApiClient,
  TelegramApiError,
  telegramGiveawayIdSchema,
} from "@kaspa-actions/agent";
import {
  loadGiveawayV6PublicFacts,
  markTelegramGroupRemoved,
  migrateTelegramGroupChat,
} from "@kaspa-actions/application";
import {
  NotificationRuleStatus,
  TelegramOutboxStatus,
  prisma as defaultPrisma,
  type PrismaClient,
} from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { z } from "zod";
import { outboxDelayMs, shouldDeadLetterOutbox } from "./worker-policy.ts";

const claimableStatusPayload = z.object({
  amountSompi: z.string().regex(/^\d+$/),
  explorerUrl: z.string().url(),
  status: z.enum(["claimed", "returned"]),
  title: z.string().min(1).max(80),
});

const paymentPayload = z.object({
  actionTitle: z.string().min(1).max(80),
  amountSompi: z.string().regex(/^\d+$/),
  explorerUrl: z.string().url(),
  supporterMessage: z.string().max(280).nullable().optional(),
  supporterName: z.string().max(40).nullable().optional(),
  txId: z.string().min(1).max(128),
});
const resultPayload = z
  .object({
    publicId: telegramGiveawayIdSchema,
    title: z.string().min(1).max(80),
    status: z.enum(["DRAWN", "NO_ENTRIES", "CANCELLED"]),
  })
  .strict();

const groupGiveawayPayload = z
  .object({
    event: z.enum(["announce", "ask", "reminder", "result"]),
    groupGiveawayId: z.string().min(1).max(64),
  })
  .strict();

export async function deliverOutbox(
  client: TelegramApiClient,
  now: Date,
  prisma: PrismaClient = defaultPrisma,
) {
  await prisma.telegramOutbox.updateMany({
    data: { lockedAt: null, status: TelegramOutboxStatus.PENDING },
    where: {
      lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
      status: TelegramOutboxStatus.PROCESSING,
    },
  });
  const candidates = await prisma.telegramOutbox.findMany({
    orderBy: { createdAt: "asc" },
    take: 25,
    where: { availableAt: { lte: now }, status: TelegramOutboxStatus.PENDING },
  });
  for (const candidate of candidates) {
    const lockedAt = new Date();
    const locked = await prisma.telegramOutbox.updateMany({
      data: { lockedAt, status: TelegramOutboxStatus.PROCESSING },
      where: { id: candidate.id, status: TelegramOutboxStatus.PENDING },
    });
    if (locked.count !== 1) continue;
    const lease = { id: candidate.id, status: TelegramOutboxStatus.PROCESSING, lockedAt };
    const suppress = () =>
      prisma.telegramOutbox.updateMany({
        where: lease,
        data: {
          lockedAt: null,
          status: TelegramOutboxStatus.DEAD,
          lastErrorCode: "DELIVERY_NOT_AUTHORIZED",
        },
      });
    let activeConnectionId: string | null = null;
    let activeSubscriberUserId: string | null = null;
    let activeGroupChatId: string | null = null;
    try {
      let ruleIds: string[] = [];
      if (candidate.kind === "group.giveaway") {
        if (
          process.env.TOCCATA_LAB_ENABLED !== "true" ||
          process.env.GIVEAWAY_LAB_ENABLED !== "true"
        ) {
          await suppress();
          continue;
        }
        const payload = groupGiveawayPayload.parse(candidate.payload);
        const link = await prisma.telegramGroupGiveaway.findUnique({
          where: { id: payload.groupGiveawayId },
          select: {
            giveawayId: true,
            group: { select: { chatId: true, removedAt: true, title: true } },
            id: true,
            linkedByTelegramUserId: true,
            postConfirmedAt: true,
            postDeclinedAt: true,
          },
        });
        if (!link || link.group.removedAt) {
          await suppress();
          continue;
        }
        const stateChanged = () =>
          prisma.telegramOutbox.updateMany({
            where: lease,
            data: {
              lockedAt: null,
              status: TelegramOutboxStatus.DEAD,
              lastErrorCode: "STATE_CHANGED",
            },
          });
        // Only a post the admin chose goes to the group; a decided question is not asked.
        const decided = link.postConfirmedAt !== null || link.postDeclinedAt !== null;
        if (payload.event === "ask" ? decided : link.postConfirmedAt === null) {
          await stateChanged();
          continue;
        }
        // The post shows the giveaway as it is now, not as it was when queued.
        const facts = await loadGiveawayV6PublicFacts(prisma, { id: link.giveawayId });
        // Paused chain verification usually recovers; retry with the usual backoff.
        if (facts?.verificationPaused) throw new Error("Giveaway verification is paused.");
        if (!facts || facts.network !== "MAINNET") {
          await stateChanged();
          continue;
        }
        if (payload.event === "ask") {
          if (facts.phase !== "open") {
            await stateChanged();
            continue;
          }
          // The admin's private chat with the bot has the same id as the admin.
          await client.sendMessage({
            chatId: link.linkedByTelegramUserId,
            ...groupPostQuestion({
              amountKas: facts.amountKas,
              groupTitle: link.group.title,
              linkId: link.id,
              title: facts.title,
            }),
          });
        } else {
          const message = groupGiveawayMessage(
            payload.event,
            facts,
            new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin,
          );
          if (!message) {
            await stateChanged();
            continue;
          }
          activeGroupChatId = link.group.chatId;
          const sent = await client.sendMessage({ chatId: link.group.chatId, ...message });
          if (payload.event === "announce") {
            try {
              await client.sendMessage({
                chatId: link.linkedByTelegramUserId,
                ...groupPostedMessage({
                  chatId: link.group.chatId,
                  groupTitle: link.group.title,
                  messageId: sent.message_id,
                  title: facts.title,
                }),
              });
            } catch {
              // The group post went out; a missed confirmation must not repeat it.
            }
          }
        }
      } else if (candidate.kind === "giveaway.result") {
        if (
          process.env.TOCCATA_LAB_ENABLED !== "true" ||
          process.env.GIVEAWAY_LAB_ENABLED !== "true"
        ) {
          await suppress();
          continue;
        }
        const subscription = candidate.subscriptionId
          ? await prisma.telegramGiveawaySubscription.findUnique({
              where: { id: candidate.subscriptionId },
              include: { giveaway: { select: { publicId: true } } },
            })
          : null;
        if (!subscription || subscription.revokedAt) {
          await suppress();
          continue;
        }
        const payload = resultPayload.parse(candidate.payload);
        if (payload.publicId !== subscription.giveaway.publicId) {
          await suppress();
          continue;
        }
        const base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin;
        const text =
          payload.status === "DRAWN"
            ? "The giveaway result is ready. Check the winner and payout status."
            : payload.status === "NO_ENTRIES"
              ? "The giveaway closed without entries."
              : "The giveaway was cancelled.";
        activeSubscriberUserId = subscription.telegramUserId;
        await client.sendMessage({
          chatId: subscription.telegramChatId,
          text: `${payload.title}\n${text}`,
          buttons: [
            [
              {
                text: "View result",
                web_app: { url: `${base}/toccata-lab/giveaway/${payload.publicId}` },
              },
            ],
            [{ text: "Turn off reminder", callback_data: `watch:off:${payload.publicId}` }],
          ],
        });
      } else if (candidate.kind === "claimable.status") {
        // The creator's own claim link changed hands; no opt-in needed, but a
        // blocked or removed chat is never messaged.
        const connection = candidate.connectionId
          ? await prisma.telegramConnection.findUnique({ where: { id: candidate.connectionId } })
          : null;
        if (!connection || connection.blockedAt) {
          await suppress();
          continue;
        }
        const payload = claimableStatusPayload.parse(candidate.payload);
        activeConnectionId = connection.id;
        await client.sendMessage({
          chatId: connection.telegramChatId,
          text:
            payload.status === "claimed"
              ? `Claimed\n${formatSompiToKaspa(payload.amountSompi)} KAS · ${payload.title}\nThe recipient claimed your link.`
              : `Returned to your wallet\n${formatSompiToKaspa(payload.amountSompi)} KAS · ${payload.title}\nNobody claimed the link in time.`,
          buttons: [[{ text: "View transaction", url: payload.explorerUrl }]],
        });
      } else if (candidate.kind === "payment.confirmed") {
        const connection = candidate.connectionId
          ? await prisma.telegramConnection.findUnique({ where: { id: candidate.connectionId } })
          : null;
        if (!connection || connection.blockedAt) {
          await suppress();
          continue;
        }
        const storedRuleIds = Array.isArray(candidate.matchedRuleIds)
          ? candidate.matchedRuleIds.filter((id): id is string => typeof id === "string")
          : [];
        const rules = storedRuleIds.length
          ? await prisma.notificationRule.findMany({
              where: {
                id: { in: storedRuleIds },
                creatorId: connection.creatorId,
                status: NotificationRuleStatus.ACTIVE,
              },
              select: { id: true },
            })
          : [];
        ruleIds = rules.map((rule) => rule.id);
        if (!connection.notificationsEnabled && ruleIds.length === 0) {
          await suppress();
          continue;
        }
        const payload = paymentPayload.parse(candidate.payload);
        const supporter =
          connection.supporterDetailsEnabled && payload.supporterName
            ? `\nSupporter: ${payload.supporterName}${payload.supporterMessage ? ` - ${payload.supporterMessage}` : ""}`
            : "";
        activeConnectionId = connection.id;
        await client.sendMessage({
          chatId: connection.telegramChatId,
          text: `Payment confirmed\n${formatSompiToKaspa(payload.amountSompi)} KAS for ${payload.actionTitle}\nTX ${payload.txId.slice(0, 10)}...${payload.txId.slice(-8)}${supporter}`,
          buttons: [[{ text: "View transaction", url: payload.explorerUrl }]],
        });
      } else {
        await suppress();
        continue;
      }
      await prisma.$transaction(async (tx) => {
        const sent = await tx.telegramOutbox.updateMany({
          where: lease,
          data: { lockedAt: null, sentAt: new Date(), status: TelegramOutboxStatus.SENT },
        });
        if (sent.count === 1 && ruleIds.length)
          await tx.notificationRule.updateMany({
            where: {
              completeOnInvoicePayment: true,
              id: { in: ruleIds },
              status: NotificationRuleStatus.ACTIVE,
            },
            data: { completedAt: new Date(), status: NotificationRuleStatus.COMPLETED },
          });
      });
    } catch (error) {
      if (
        error instanceof TelegramApiError &&
        error.migrateToChatId &&
        activeGroupChatId &&
        candidate.attempts < 3
      ) {
        // The group became a supergroup; move it and send again on the next pass.
        await migrateTelegramGroupChat(prisma, activeGroupChatId, error.migrateToChatId);
        await prisma.telegramOutbox.updateMany({
          where: lease,
          data: {
            attempts: candidate.attempts + 1,
            lockedAt: null,
            status: TelegramOutboxStatus.PENDING,
          },
        });
        continue;
      }
      const attempts = candidate.attempts + 1;
      const permanent =
        error instanceof z.ZodError || (error instanceof TelegramApiError && error.permanent);
      const dead = shouldDeadLetterOutbox({ attempts, permanent });
      const delay = Math.max(
        outboxDelayMs(attempts),
        error instanceof TelegramApiError ? (error.retryAfterSeconds ?? 0) * 1000 : 0,
      );
      await prisma.$transaction(async (tx) => {
        const updated = await tx.telegramOutbox.updateMany({
          where: lease,
          data: {
            attempts,
            availableAt: new Date(Date.now() + delay),
            lastErrorCode:
              error instanceof TelegramApiError
                ? `TELEGRAM_${error.errorCode ?? "ERROR"}`
                : "DELIVERY_ERROR",
            lockedAt: null,
            status: dead ? TelegramOutboxStatus.DEAD : TelegramOutboxStatus.PENDING,
          },
        });
        if (
          updated.count === 1 &&
          error instanceof TelegramApiError &&
          error.connectionUnavailable
        ) {
          if (activeConnectionId)
            await tx.telegramConnection.updateMany({
              where: { id: activeConnectionId },
              data: {
                blockedAt: new Date(),
                disabledReason: "Telegram blocked delivery. Reconnect this chat.",
                notificationsEnabled: false,
              },
            });
          if (activeSubscriberUserId)
            await tx.telegramGiveawaySubscription.updateMany({
              where: { telegramUserId: activeSubscriberUserId },
              data: { revokedAt: new Date() },
            });
        }
      });
      // The bot was removed from the group; stop posting there.
      if (activeGroupChatId && error instanceof TelegramApiError && error.connectionUnavailable)
        await markTelegramGroupRemoved(prisma, activeGroupChatId);
    }
  }
}
