import { ESCROW_STATUS_META, type EscrowStatusTone } from "../_lib/escrow-status";
import type { EscrowStatus } from "../_lib/escrow-types";

// Reuses the shared status pills; only the neutral "closed" tone is escrow-specific.
const TONE_CLASS: Record<EscrowStatusTone, string> = {
  active: "status-profile-visible",
  attention: "status-expired",
  closed: "escrow-status-closed",
  success: "status-confirmed",
  waiting: "status-pending",
};

export function EscrowStatusBadge({ status }: { status: EscrowStatus }) {
  const meta = ESCROW_STATUS_META[status];
  return <span className={`status-pill ${TONE_CLASS[meta.tone]}`}>{meta.label}</span>;
}
