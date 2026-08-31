import { TelegramApiClient } from "@kaspa-actions/agent";

import { env } from "./config.ts";

const appUrl = env("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
const client = new TelegramApiClient(env("TELEGRAM_BOT_TOKEN"));
await client.setWebhook({
  secretToken: env("TELEGRAM_WEBHOOK_SECRET"),
  url: `${appUrl}/api/agent/telegram/webhook`,
});
await client.setMyCommands([
  { command: "help", description: "Show all KaspaLinks Agent commands" },
  { command: "links", description: "Show your recent links" },
  { command: "payments", description: "Show recent confirmed payments" },
  { command: "stats", description: "Show your totals" },
  { command: "giveaways", description: "Show your recent giveaways" },
  { command: "link", description: "Create a transfer link" },
  { command: "invoice", description: "Create a fixed invoice" },
  { command: "tip", description: "Create a tip link" },
  { command: "donation", description: "Create a donation link" },
  { command: "goal", description: "Create a funding goal" },
  { command: "giveaway", description: "Prepare a giveaway" },
  { command: "disconnect", description: "Disconnect this Telegram chat" },
]);
console.info("Telegram webhook and command menu registered.");
