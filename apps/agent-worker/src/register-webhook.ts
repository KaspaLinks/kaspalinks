import { TelegramApiClient } from "@kaspa-actions/agent";

import { env } from "./config.ts";

const appUrl = env("NEXT_PUBLIC_APP_URL").replace(/\/$/, "");
const client = new TelegramApiClient(env("TELEGRAM_BOT_TOKEN"));
await client.setWebhook({
  secretToken: env("TELEGRAM_WEBHOOK_SECRET"),
  url: `${appUrl}/api/agent/telegram/webhook`,
});
console.info("Telegram webhook registered.");
