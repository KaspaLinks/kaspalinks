import { EscrowAccessGate } from "./_components/EscrowAccessGate";
import { EscrowOverview } from "./EscrowOverview";

export const dynamic = "force-dynamic";

export default function EscrowPage() {
  return (
    <EscrowAccessGate title="Escrow links">
      <EscrowOverview />
    </EscrowAccessGate>
  );
}
