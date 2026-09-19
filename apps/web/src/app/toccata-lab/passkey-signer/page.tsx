import { EscrowAccessGate } from "../../escrow/_components/EscrowAccessGate";
import { PasskeySignerLab } from "./PasskeySignerLab";

export const dynamic = "force-dynamic";

export default function PasskeySignerPage() {
  return (
    <EscrowAccessGate title="Passkey signer lab">
      <PasskeySignerLab />
    </EscrowAccessGate>
  );
}
