import { notFound } from "next/navigation";

import { EscrowAccessGate } from "../_components/EscrowAccessGate";
import { isEscrowFixtureId } from "../_lib/escrow-fixtures";
import { EscrowDealClient } from "./EscrowDealClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EscrowDealPage({ params }: PageProps) {
  const { id } = await params;
  if (!isEscrowFixtureId(id)) {
    notFound();
  }

  return (
    <EscrowAccessGate title="Escrow link">
      <EscrowDealClient id={id} />
    </EscrowAccessGate>
  );
}
