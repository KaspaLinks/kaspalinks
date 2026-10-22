import type { Metadata } from "next";

import { getAccountFreeTurnstileClientConfig } from "@/lib/turnstile";

import { GiveawayV6Studio } from "./GiveawayV6Studio";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Create and manage a non-custodial SilverScript giveaway on Kaspa Mainnet.",
  robots: { follow: false, index: false },
  title: "Giveaway Studio",
};

export default function NewGiveawayPage() {
  return (
    <GiveawayV6Studio guestTurnstile={getAccountFreeTurnstileClientConfig()} surface="browser" />
  );
}
