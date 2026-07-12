import type { Metadata } from "next";

import { MyLinksClient } from "./MyLinksClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "My links",
};

export default function MyLinksPage() {
  return <MyLinksClient />;
}
