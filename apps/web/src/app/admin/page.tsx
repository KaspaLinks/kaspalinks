import type { Metadata } from "next";

import { AdminClient } from "./AdminClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false, nocache: true },
  title: "Admin",
};

export default function AdminPage() {
  return <AdminClient />;
}
