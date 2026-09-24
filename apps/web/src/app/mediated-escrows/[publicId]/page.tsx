import { prisma } from "@kaspa-actions/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { mediatedEscrowPublicIdSchema } from "@/lib/mediated-escrow-v2";
import { MediatedEscrowClient } from "./MediatedEscrowClient";

export const dynamic = "force-dynamic";

async function readEscrow(publicId: string) {
  if (!isEscrowPrototypeEnabled()) return null;
  const parsed = mediatedEscrowPublicIdSchema.safeParse(publicId);
  if (!parsed.success) return null;
  return prisma.mediatedEscrowPrototype.findUnique({
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
    description:
      "A non-custodial Kaspa purchase escrow with buyer, seller and an independent mediator.",
    robots: { follow: false, index: false },
    title: `${row.title} · Protected Kaspa escrow`,
  };
}

export default async function MediatedEscrowPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const row = await readEscrow((await params).publicId);
  if (!row) notFound();
  return <MediatedEscrowClient publicId={row.publicId} />;
}
