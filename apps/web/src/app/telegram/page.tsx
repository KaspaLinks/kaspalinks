import Script from "next/script";
import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";
import { isGiveawayLabEnabled } from "@/lib/giveaway-lab";
import { getGiveawayTurnstileClientConfig } from "@/lib/turnstile";
import { isClaimableAnonymousEnabled, isClaimableAutoReturnEnabled } from "@/lib/claimable-flags";
import {
  getToccataLabCapabilityNames,
  isToccataLabEnabled,
  readToccataLabCapabilities,
} from "@/lib/toccata-lab";
import { TelegramGiveawayApp } from "./TelegramGiveawayApp";

function readClaimCapabilities() {
  try {
    return readToccataLabCapabilities();
  } catch (error) {
    return { missing: [(error as Error).message], ready: false, version: "unknown" };
  }
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Kaspa Links", robots: { index: false, follow: false } };
export default function TelegramPage() {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js?63" strategy="beforeInteractive" />
      <TelegramGiveawayApp
        claim={{
          anonymousEnabled: isClaimableAnonymousEnabled(),
          autoReturnEnabled: isClaimableAutoReturnEnabled(),
          capabilities: readClaimCapabilities(),
          enabled: isToccataLabEnabled(),
          requiredCapabilities: getToccataLabCapabilityNames(),
        }}
        entryEnabled={isGiveawayLabEnabled()}
        studioEnabled={isGiveawayV6CreationEnabled()}
        turnstile={getGiveawayTurnstileClientConfig()}
        botUsername={process.env.TELEGRAM_BOT_USERNAME ?? ""}
      />
    </>
  );
}
