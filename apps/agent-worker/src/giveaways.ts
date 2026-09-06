import { queueGiveawayResults } from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";
let lastCheckAt = 0;

export async function processGiveawayReminders(now: Date) {
  if (process.env.TOCCATA_LAB_ENABLED !== "true" || process.env.GIVEAWAY_LAB_ENABLED !== "true")
    return;
  if (now.getTime() - lastCheckAt < 15_000) return;
  lastCheckAt = now.getTime();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (secret) {
    try {
      const base = process.env.AGENT_INTERNAL_APP_URL?.trim() || "http://app:3000";
      const response = await fetch(`${new URL(base).origin}/api/agent/giveaways/tick`, {
        method: "POST",
        headers: { "x-telegram-bot-api-secret-token": secret },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) console.error("Giveaway processing returned HTTP", response.status);
    } catch {
      console.error("Giveaway processing is temporarily unavailable.");
    }
  }
  // A temporary draw outage must not delay results already committed to the DB.
  await queueGiveawayResults(prisma, new Date());
}
