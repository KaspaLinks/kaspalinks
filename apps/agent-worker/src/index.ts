import { TelegramApiClient } from "@kaspa-actions/agent";
import {
  detectAndConfirmPayment,
  expireAgentData,
  scheduleNextPaymentDetection,
} from "@kaspa-actions/application";
import { PaymentRequestStatus, prisma } from "@kaspa-actions/db";
import { createRestKaspaIndexer, type KaspaIndexer } from "@kaspa-actions/kaspa-indexer";

import { agentWorkerEnabled, env } from "./config.ts";
import { deliverOutbox } from "./outbox.ts";
import { processGiveawayReminders } from "./giveaways.ts";

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

async function tick(client: TelegramApiClient) {
  const now = new Date();
  const results = await Promise.allSettled([
    (async () => {
      await expirePendingRequests(now);
      await detectPayments(now);
    })(),
    processGiveawayReminders(now),
  ]);
  for (const result of results)
    if (result.status === "rejected") console.error("Agent background processing failed.");
  await deliverOutbox(client, new Date());
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
