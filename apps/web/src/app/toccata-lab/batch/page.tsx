import type { Metadata } from "next";

import { BatchClaimableLabClient } from "./BatchClaimableLabClient";

import { isToccataBatchLabEnabled, readToccataLabCapabilities } from "@/lib/toccata-lab";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Private Batch Claim Lab",
};

export default function BatchClaimableLabPage() {
  let capabilities;
  try {
    capabilities = readToccataLabCapabilities();
  } catch (error) {
    capabilities = { missing: [(error as Error).message], ready: false, version: "unknown" };
  }
  return <BatchClaimableLabClient capabilities={capabilities} enabled={isToccataBatchLabEnabled()} />;
}
