import type { Metadata } from "next";

import { ClaimableLinksShell } from "./ClaimableLinksShell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Claimable Links",
};

export default async function ToccataLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const view = (await searchParams).view;
  const mode = view === "claim" ? "claim" : view === "manage" ? "manage" : "create";
  return <ClaimableLinksShell mode={mode} />;
}
