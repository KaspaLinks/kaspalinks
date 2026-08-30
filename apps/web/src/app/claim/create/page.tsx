import type { Metadata } from "next";
import { TOCCATA_BATCH_MAX_SAFE_OUTPUTS } from "@kaspa-actions/kaspa/toccata-constants";

import { ClaimableCreateChooser } from "./ClaimableCreateChooser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/claim/create" },
  description: `Create one claimable Kaspa reward or a Claim Drop with up to ${TOCCATA_BATCH_MAX_SAFE_OUTPUTS} individually shareable links.`,
  robots: {
    follow: false,
    index: false,
  },
  title: "Create Claimable Rewards",
};

function parseInitialCount(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return 1;
  return Math.min(TOCCATA_BATCH_MAX_SAFE_OUTPUTS, Math.max(1, Number(raw)));
}

export default async function ClaimableCreatePage({
  searchParams,
}: {
  searchParams?: Promise<{ count?: string | string[] }>;
}) {
  const query = (await searchParams) ?? {};
  return <ClaimableCreateChooser initialCount={parseInitialCount(query.count)} />;
}
