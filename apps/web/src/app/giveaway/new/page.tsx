import type { Metadata } from "next";

import { getAccountFreeTurnstileClientConfig } from "@/lib/turnstile";

import { GiveawayV6Studio } from "./GiveawayV6Studio";

export const dynamic = "force-dynamic";

const SHARE_TITLE = "Run your own Kaspa giveaway";
const SHARE_DESCRIPTION =
  "Lock a KAS prize in an on-chain contract, share one link and let the draw pay the winner automatically. Free to join, no account needed.";
const PATH = "/giveaway/new";
const IMAGE_PATH = `${PATH}/opengraph-image`;

export const metadata: Metadata = {
  description: "Create and manage a non-custodial SilverScript giveaway on Kaspa Mainnet.",
  // The studio is not indexed, but links to it are shared, so it gets its own card.
  openGraph: {
    description: SHARE_DESCRIPTION,
    images: [{ alt: SHARE_TITLE, height: 630, url: IMAGE_PATH, width: 1200 }],
    title: SHARE_TITLE,
    type: "website",
    url: PATH,
  },
  robots: { follow: false, index: false },
  title: "Giveaway Studio",
  twitter: {
    card: "summary_large_image",
    description: SHARE_DESCRIPTION,
    images: [IMAGE_PATH],
    title: SHARE_TITLE,
  },
};

export default function NewGiveawayPage() {
  return (
    <GiveawayV6Studio guestTurnstile={getAccountFreeTurnstileClientConfig()} surface="browser" />
  );
}
