import type { Metadata } from "next";

import { ClaimableLinksShell } from "../../toccata-lab/ClaimableLinksShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/claim/create" },
  description:
    "Create a claimable Kaspa link, fund its one-time address, then share it with the first person who should claim the KAS.",
  robots: {
    follow: false,
    index: false,
  },
  title: "Create Claimable Link",
};

export default function ClaimableCreatePage() {
  return <ClaimableLinksShell mode="create" />;
}
