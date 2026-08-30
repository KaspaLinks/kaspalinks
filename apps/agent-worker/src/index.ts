import { TelegramApiClient, TelegramApiError } from "@kaspa-actions/agent";
import {
  detectAndConfirmPayment,
  expireAgentData,
  scheduleNextPaymentDetection,
} from "@kaspa-actions/application";
import {
  NotificationRuleStatus,
  PaymentRequestStatus,
  TelegramOutboxStatus,
  prisma,
} from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { createRestKaspaIndexer, type KaspaIndexer } from "@kaspa-actions/kaspa-indexer";
import { z } from "zod";

import { agentWorkerEnabled, env } from "./config.ts";
import { outboxDelayMs, shouldDeadLetterOutbox } from "./worker-policy.ts";

const LOOP_INTERVAL_MS = 1_000;
let lastRetentionAt = 0;

function indexerFor(network: "MAINNET" | "TESTNET"): KaspaIndexer | null {
  if (process.env.KASPA_INDEXER_ENABLED !== "true") return null;
  const mainnet = process.env.KASPA_MAINNET_INDEXER_URL?.trim() || "https://api.kaspa.org";
  const testnet = process.env.KASPA_TESTNET_INDEXER_URL?.trim();
  const baseUrl = network === "MAINNET" ? mainnet : testnet;
  if (!baseUrl) return null;
  return createRestKaspaIndexer({
    baseUrl,
    providerId:
      network === "MAINNET"
        ? process.env.KASPA_MAINNET_INDEXER_PROVIDER_ID?.trim()
        : process.env.KASPA_TESTNET_INDEXER_PROVIDER_ID?.trim(),
  });
}

const indexers = {
  MAINNET: indexerFor("MAINNET"),
  TESTNET: indexerFor("TESTNET"),
};

async function expirePendingRequests(now: Date) {
  const expired = await prisma.paymentRequest.findMany({
    select: { actionId: true, id: true },
    take: 100,
    where: { expiresAt: { lte: now }, status: PaymentRequestStatus.PENDING },
  });
  for (const item of expired) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.paymentRequest.updateMany({
        data: { failedAt: now, nextDetectionAt: null, status: PaymentRequestStatus.EXPIRED },
        where: { id: item.id, status: PaymentRequestStatus.PENDING },
      });
      if (updated.count === 1) {
        await tx.auditLog.create({
          data: {
            actionId: item.actionId,
            event: "payment_request.worker_expired",
            paymentRequestId: item.id,
          },
        });
      }
    });
  }
}

async function detectPayments(now: Date) {
  const pending = await prisma.paymentRequest.findMany({
    orderBy: [{ nextDetectionAt: "asc" }, { createdAt: "asc" }],
    take: 25,
    where: {
      expiresAt: { gt: now },
      OR: [{ nextDetectionAt: null }, { nextDetectionAt: { lte: now } }],
      status: PaymentRequestStatus.PENDING,
    },
  });

  for (const request of pending) {
    const indexer = indexers[request.network];
    if (!indexer) continue;
    const result = await detectAndConfirmPayment(request, indexer, prisma, {}, now.getTime());
    if (result.kind !== "confirmed" && result.kind !== "skipped") {
      await scheduleNextPaymentDetection(prisma, request.id, request.detectionAttempts + 1, now);
    }
  }
}

const paymentNotificationPayloadSchema = z.object({
  actionTitle: z.string().min(1).max(80),
  amountSompi: z.string().regex(/^\d+$/),
  explorerUrl: z.string().url(),
  supporterMessage: z.string().max(280).nullable().optional(),
  supporterName: z.string().max(40).nullable().optional(),
  txId: z.string().min(1).max(128),
});

async function deliverOutbox(client: TelegramApiClient, now: Date) {
  await prisma.telegramOutbox.updateMany({
    data: { lockedAt: null, status: TelegramOutboxStatus.PENDING },
    where: {
      lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) },
      status: TelegramOutboxStatus.PROCESSING,
    },
  });
  const candidates = await prisma.telegramOutbox.findMany({
    include: { connection: true },
    orderBy: { createdAt: "asc" },
    take: 25,
    where: { availableAt: { lte: now }, status: TelegramOutboxStatus.PENDING },
  });

  for (const candidate of candidates) {
    const locked = await prisma.telegramOutbox.updateMany({
      data: { lockedAt: now, status: TelegramOutboxStatus.PROCESSING },
      where: { id: candidate.id, status: TelegramOutboxStatus.PENDING },
    });
    if (locked.count !== 1) continue;
    const connection = candidate.connection;
    if (!connection || connection.blockedAt) {
      await prisma.telegramOutbox.update({
        data: { lastErrorCode: "CONNECTION_UNAVAILABLE", status: TelegramOutboxStatus.DEAD },
        where: { id: candidate.id },
      });
      continue;
    }

    try {
      const payload = paymentNotificationPayloadSchema.parse(candidate.payload);
      const amountKas = formatSompiToKaspa(payload.amountSompi);
      const txShort = `${payload.txId.slice(0, 10)}...${payload.txId.slice(-8)}`;
      const supporter = payload.supporterName
        ? `\nSupporter: ${payload.supporterName}${payload.supporterMessage ? ` - ${payload.supporterMessage}` : ""}`
        : "";
      await client.sendMessage({
        buttons: [[{ text: "View transaction", url: payload.explorerUrl }]],
        chatId: connection.telegramChatId,
        text: `Payment confirmed\n${amountKas} KAS for ${payload.actionTitle}\nTX ${txShort}${supporter}`,
      });

      const ruleIds = Array.isArray(candidate.matchedRuleIds)
        ? candidate.matchedRuleIds.filter((value): value is string => typeof value === "string")
        : [];
      await prisma.$transaction([
        prisma.telegramOutbox.update({
          data: { lockedAt: null, sentAt: now, status: TelegramOutboxStatus.SENT },
          where: { id: candidate.id },
        }),
        prisma.notificationRule.updateMany({
          data: { completedAt: now, status: NotificationRuleStatus.COMPLETED },
          where: { completeOnInvoicePayment: true, id: { in: ruleIds } },
        }),
      ]);
    } catch (error) {
      const attempts = candidate.attempts + 1;
      const permanent = error instanceof TelegramApiError && error.permanent;
      const dead = shouldDeadLetterOutbox({ attempts, permanent });
      await prisma.$transaction(async (tx) => {
        await tx.telegramOutbox.update({
          data: {
            attempts,
            availableAt: new Date(now.getTime() + outboxDelayMs(attempts)),
            lastErrorCode:
              error instanceof TelegramApiError
                ? `TELEGRAM_${error.errorCode ?? "ERROR"}`
                : "DELIVERY_ERROR",
            lockedAt: null,
            status: dead ? TelegramOutboxStatus.DEAD : TelegramOutboxStatus.PENDING,
          },
          where: { id: candidate.id },
        });
        if (permanent) {
          await tx.telegramConnection.update({
            data: {
              blockedAt: now,
              disabledReason: "Telegram blocked or rejected delivery.",
              notificationsEnabled: false,
            },
            where: { id: connection.id },
          });
        }
      });
    }
  }
}

async function tick(client: TelegramApiClient) {
  const now = new Date();
  await expirePendingRequests(now);
  await detectPayments(now);
  await deliverOutbox(client, now);
  if (now.getTime() - lastRetentionAt >= 24 * 60 * 60_000) {
    await expireAgentData(prisma, now);
    lastRetentionAt = now.getTime();
  }
}

async function main() {
  if (!agentWorkerEnabled()) {
    console.info("KaspaLinks Agent worker is disabled.");
    setInterval(() => undefined, 60_000);
    return;
  }
  const client = new TelegramApiClient(env("TELEGRAM_BOT_TOKEN"));
  console.info("KaspaLinks Agent worker started.");
  while (true) {
    const started = Date.now();
    try {
      await tick(client);
    } catch (error) {
      console.error("Agent worker tick failed:", (error as Error).message);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(50, LOOP_INTERVAL_MS - (Date.now() - started))),
    );
  }
}

await main();
