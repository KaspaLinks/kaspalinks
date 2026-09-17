import { EscrowAccessGate } from "../_components/EscrowAccessGate";
import { NewEscrowClient } from "./NewEscrowClient";

export const dynamic = "force-dynamic";

export default function NewEscrowPage() {
  return (
    <EscrowAccessGate title="New escrow link">
      <NewEscrowClient />
    </EscrowAccessGate>
  );
}
