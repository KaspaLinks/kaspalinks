import type { Metadata } from "next";
import { TOCCATA_BATCH_MAX_SAFE_OUTPUTS } from "@kaspa-actions/kaspa/toccata-constants";

import { isToccataBatchLabEnabled, readToccataLabCapabilities } from "@/lib/toccata-lab";

import { BatchClaimableLabClient } from "../../toccata-lab/batch/BatchClaimableLabClient";

export const dynamic = "force-dynamic";

const DESCRIPTION = `Create a Claim Drop with 2 to ${TOCCATA_BATCH_MAX_SAFE_OUTPUTS} separate Kaspa rewards, fund the batch once, and share each non-custodial claim link individually.`;

export const metadata: Metadata = {
  alternates: { canonical: "/claim/batch" },
  description: DESCRIPTION,
  openGraph: {
    description: DESCRIPTION,
    title: "Create a Claim Drop",
    type: "website",
    url: "/claim/batch",
  },
  title: "Create a Claim Drop",
  twitter: {
    card: "summary_large_image",
    description: DESCRIPTION,
    title: "Create a Claim Drop",
  },
};

function parseInitialCount(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return 2;
  return Math.min(TOCCATA_BATCH_MAX_SAFE_OUTPUTS, Math.max(2, Number(raw)));
}

export default async function ClaimBatchPage({
  searchParams,
}: {
  searchParams?: Promise<{ count?: string | string[] }>;
}) {
  const query = (await searchParams) ?? {};
  let capabilities;
  try {
    capabilities = readToccataLabCapabilities();
  } catch (error) {
    capabilities = { missing: [(error as Error).message], ready: false, version: "unknown" };
  }

  return (
    <BatchClaimableLabClient
      capabilities={capabilities}
      enabled={isToccataBatchLabEnabled()}
      initialCount={parseInitialCount(query.count)}
    />
  );
}
