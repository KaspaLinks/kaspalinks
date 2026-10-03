// Asks the app to return expired auto-return claimable links (docs/adr/0007).
// The app owns the Kaspa SDK and relay access; the return itself is keyless.

const CLAIMABLE_RETURN_INTERVAL_MS = 60_000;
let lastCheckAt = 0;

export async function processClaimableReturns(now: Date) {
  if (process.env.TOCCATA_LAB_ENABLED !== "true") return;
  if (now.getTime() - lastCheckAt < CLAIMABLE_RETURN_INTERVAL_MS) return;
  lastCheckAt = now.getTime();

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) return;
  try {
    const base = process.env.AGENT_INTERNAL_APP_URL?.trim() || "http://app:3000";
    const response = await fetch(`${new URL(base).origin}/api/internal/claimable-returns/tick`, {
      headers: { "x-telegram-bot-api-secret-token": secret },
      method: "POST",
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) console.error("Claimable return processing returned HTTP", response.status);
  } catch {
    console.error("Claimable return processing is temporarily unavailable.");
  }
}
