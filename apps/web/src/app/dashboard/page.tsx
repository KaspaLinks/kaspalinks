import type { Metadata } from "next";

import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Per-creator dashboard — no value in search results; the SSR output is
  // just a loading placeholder until the client hydrates with the token.
  robots: { follow: false, index: false },
  title: "Dashboard",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
