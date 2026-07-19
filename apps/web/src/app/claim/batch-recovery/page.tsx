import type { Metadata } from "next";

import { isToccataBatchLabEnabled, readToccataLabCapabilities } from "@/lib/toccata-lab";

import { BatchClaimableLabClient } from "../../toccata-lab/batch/BatchClaimableLabClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Recover Claim Batch",
};

export default function BatchRecoveryPage() {
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
      mode="recovery"
    />
  );
}
