import { prisma } from "@kaspa-actions/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { escrowLinkPublicIdSchema } from "@/lib/escrow-link";
import { isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { EscrowLinkClient } from "./EscrowLinkClient";

export const dynamic = "force-dynamic";

async function readEscrow(publicId: string) {
  if (!isEscrowPrototypeEnabled()) return null;
  const parsed = escrowLinkPublicIdSchema.safeParse(publicId);
  if (!parsed.success) return null;
  return prisma.escrowLinkPrototype.findUnique({
    select: { publicId: true, title: true },
    where: { publicId: parsed.data },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const row = await readEscrow((await params).publicId);
  if (!row) return { title: "Escrow not found · Kaspa Links" };
  return {
    description: "A private, non-custodial Kaspa escrow protected by SilverScript and passkeys.",
    robots: { follow: false, index: false },
    title: `${row.title} · Kaspa escrow`,
  };
}

export default async function EscrowLinkPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const row = await readEscrow((await params).publicId);
  if (!row) notFound();
  return <EscrowLinkClient publicId={row.publicId} />;
}
