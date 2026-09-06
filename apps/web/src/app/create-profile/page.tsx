import { sanitizeInternalNextPath } from "@/lib/internal-next-path";
import type { Metadata } from "next";

import { CreateProfileClient } from "./CreateProfileClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/create-profile" },
  description:
    "Spin up a Kaspa Links creator profile in seconds — pick a username, get your creator token, start sharing payment links. No email, no password.",
  title: "Create profile",
};

export default async function CreateProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <CreateProfileClient
      nextPath={sanitizeInternalNextPath(typeof query.next === "string" ? query.next : undefined)}
    />
  );
}
