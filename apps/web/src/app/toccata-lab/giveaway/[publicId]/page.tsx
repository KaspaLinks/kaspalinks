import type { Metadata } from "next";

import { getGiveawayTurnstileClientConfig } from "@/lib/turnstile";

import { GiveawayEntryClient } from "./GiveawayEntryClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Giveaway Entry Lab",
};

export default async function GiveawayEntryPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <GiveawayEntryClient publicId={publicId} turnstile={getGiveawayTurnstileClientConfig()} />;
}
