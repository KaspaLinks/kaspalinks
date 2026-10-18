import type { Metadata } from "next";

import { ManageLinkClient } from "./ManageLinkClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // The manage token sits in the URL fragment; the page itself is never indexed.
  referrer: "no-referrer",
  robots: { follow: false, index: false },
  title: "Manage your link",
};

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function ManageLinkPage({ params }: PageProps) {
  const { publicId } = await params;
  return <ManageLinkClient publicId={publicId} />;
}
