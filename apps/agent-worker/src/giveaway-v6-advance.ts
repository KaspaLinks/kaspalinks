// Asks the app to fund-check and activate giveaways nobody is watching. The
// app owns the indexer and relay access; activation is keyless.

const GIVEAWAY_V6_ADVANCE_INTERVAL_MS = 10_000;
let lastCheckAt = 0;

export async function processGiveawayV6Advances(now: Date) {
  if (process.env.GIVEAWAY_V6_PROJECTION_ENABLED !== "true") return;
  if (now.getTime() - lastCheckAt < GIVEAWAY_V6_ADVANCE_INTERVAL_MS) return;
  lastCheckAt = now.getTime();

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) return;
  try {
    const base = process.env.AGENT_INTERNAL_APP_URL?.trim() || "http://app:3000";
    const response = await fetch(`${new URL(base).origin}/api/internal/giveaway-v6-advance/tick`, {
      headers: { "x-telegram-bot-api-secret-token": secret },
      method: "POST",
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) console.error("Giveaway advance processing returned HTTP", response.status);
  } catch {
    console.error("Giveaway advance processing is temporarily unavailable.");
  }
}
