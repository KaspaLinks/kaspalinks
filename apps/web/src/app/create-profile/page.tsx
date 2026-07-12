import type { Metadata } from "next";

import { CreateProfileClient } from "./CreateProfileClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/create-profile" },
  description:
    "Spin up a Kaspa Links creator profile in seconds — pick a username, get your creator token, start sharing payment links. No email, no password.",
  title: "Create profile",
};

export default function CreateProfilePage() {
  return <CreateProfileClient />;
}
