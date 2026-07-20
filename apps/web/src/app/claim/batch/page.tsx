import type { Metadata } from "next";

import { isToccataBatchLabEnabled, readToccataLabCapabilities } from "@/lib/toccata-lab";

import { BatchClaimableLabClient } from "../../toccata-lab/batch/BatchClaimableLabClient";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Create a Claim Drop with 2 to 10 separate Kaspa rewards, fund the batch once, and share each non-custodial claim link individually.";

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

export default function ClaimBatchPage() {
  let capabilities;
  try {
    capabilities = readToccataLabCapabilities();
  } catch (error) {
    capabilities = { missing: [(error as Error).message], ready: false, version: "unknown" };
  }

  return (
    <BatchClaimableLabClient capabilities={capabilities} enabled={isToccataBatchLabEnabled()} />
  );
}
