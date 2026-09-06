import Script from "next/script";
import { isGiveawayLabEnabled } from "@/lib/giveaway-lab";
import { getGiveawayTurnstileClientConfig } from "@/lib/turnstile";
import { TelegramGiveawayApp } from "./TelegramGiveawayApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kaspa Links Giveaways", robots: { index: false, follow: false } };
export default function TelegramPage() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js?63" strategy="beforeInteractive" />
      <TelegramGiveawayApp
        enabled={isGiveawayLabEnabled()}
        turnstile={getGiveawayTurnstileClientConfig()}
        botUsername={process.env.TELEGRAM_BOT_USERNAME ?? ""}
      />
    </>
  );
}
