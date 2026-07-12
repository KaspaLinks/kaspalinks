import type { Metadata } from "next";

import { NewLinkClient } from "./NewLinkClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "New link",
};

export default function NewLinkPage() {
  return <NewLinkClient />;
}
