import { TelegramApiClient } from "@kaspa-actions/agent";

import { env } from "./config.ts";

const appUrl = env("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
const client = new TelegramApiClient(env("TELEGRAM_BOT_TOKEN"));
await client.setWebhook({
  secretToken: env("TELEGRAM_WEBHOOK_SECRET"),
  url: `${appUrl}/api/agent/telegram/webhook`,
});
await client.setMyCommands([
  { command: "start", description: "Send KAS, get paid, giveaways, my links" },
  { command: "help", description: "Show all commands" },
  { command: "links", description: "Show your recent links" },
  { command: "payments", description: "Show recent confirmed payments" },
  { command: "stats", description: "Show your totals" },
  { command: "giveaways", description: "Show your recent giveaways" },
  { command: "link", description: "Create: /link <KAS> <title>" },
  { command: "invoice", description: "Create: /invoice <KAS> <title>" },
  { command: "tip", description: "Create: /tip [KAS] <title>" },
  { command: "donation", description: "Create: /donation [KAS] <title>" },
  { command: "goal", description: "Create: /goal <KAS target> <title>" },
  { command: "giveaway", description: "Create: /giveaway <KAS> <title>" },
  { command: "claim", description: "Send KAS with a link: /claim <KAS> [title]" },
  { command: "wallet", description: "Wallet for payment links: /wallet kaspa:…" },
  { command: "stop", description: "Turn off all giveaway result reminders" },
  { command: "disconnect", description: "Disconnect this Telegram chat" },
]);
// The button next to the message field opens the Mini App start screen.
await client.setChatMenuButton({ text: "Open", url: `${appUrl}/telegram` });
console.info("Telegram webhook, command menu and menu button registered.");
