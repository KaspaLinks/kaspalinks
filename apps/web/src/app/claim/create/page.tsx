import type { Metadata } from "next";

import { ClaimableCreateChooser } from "./ClaimableCreateChooser";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/claim/create" },
  description:
    "Create one claimable Kaspa reward or a Claim Drop with up to 10 individually shareable links.",
  robots: {
    follow: false,
    index: false,
  },
  title: "Create Claimable Rewards",
};

function parseInitialCount(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return 1;
  return Math.min(10, Math.max(1, Number(raw)));
}

export default async function ClaimableCreatePage({
  searchParams,
}: {
  searchParams?: Promise<{ count?: string | string[] }>;
}) {
  const query = (await searchParams) ?? {};
  return <ClaimableCreateChooser initialCount={parseInitialCount(query.count)} />;
}
