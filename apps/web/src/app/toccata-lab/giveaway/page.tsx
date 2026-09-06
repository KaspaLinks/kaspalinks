import type { Metadata } from "next";

import { GiveawayLabClient } from "./GiveawayLabClient";

import { isGiveawayLabEnabled } from "@/lib/giveaway-lab";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Private Giveaway Lab",
};

export default async function GiveawayLabPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[]; template?: string | string[] }>;
}) {
  const query = await searchParams;
  const draftId = typeof query.draft === "string" ? query.draft : undefined;
  return (
    <GiveawayLabClient
      draftId={draftId}
      templateId={typeof query.template === "string" ? query.template : undefined}
      botUsername={process.env.TELEGRAM_BOT_USERNAME ?? ""}
      enabled={isGiveawayLabEnabled()}
    />
  );
}
