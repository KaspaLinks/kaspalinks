import type { Metadata } from "next";

import { ClaimableLinksShell } from "../../toccata-lab/ClaimableLinksShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Refund Claimable Kaspa",
};

export default function ClaimRefundPage() {
  return <ClaimableLinksShell mode="manage" />;
}
