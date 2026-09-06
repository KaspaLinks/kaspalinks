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
  { command: "link", description: "Create: /link <KAS> <title>" },
  { command: "invoice", description: "Create: /invoice <KAS> <title>" },
  { command: "tip", description: "Create: /tip [KAS] <title>" },
  { command: "donation", description: "Create: /donation [KAS] <title>" },
  { command: "goal", description: "Create: /goal <KAS target> <title>" },
  { command: "giveaway", description: "Create: /giveaway <KAS> <30m|24h|7d> <title>" },
  { command: "stop", description: "Turn off all giveaway result reminders" },
  { command: "disconnect", description: "Disconnect this Telegram chat" },
]);
console.info("Telegram webhook and command menu registered.");
