import type { Metadata } from "next";

import { MyProfileClient } from "./MyProfileClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "My profile",
};

export default function MyProfilePage() {
  return <MyProfileClient />;
}
