import type { Metadata } from "next";

import { GiveawayLabClient } from "./GiveawayLabClient";

import { isGiveawayLabEnabled } from "@/lib/giveaway-lab";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Private Giveaway Lab",
};

export default function GiveawayLabPage() {
  return <GiveawayLabClient enabled={isGiveawayLabEnabled()} />;
}
