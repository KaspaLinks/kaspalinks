import type { PrototypeManifest } from "@/lib/giveaway-prize-v3-prototype";
export type StudioTrial = { id: string; manifest: PrototypeManifest; publicTitle?: string | null };
export type StudioDetail = StudioTrial & {
  entryCount?: number;
  payout?: { transactionId: string; confirmed: boolean; winnerAddress: string | null } | null;
  refund?: {
    transactionId: string;
    confirmed: boolean;
    address: string | null;
    amount: string | null;
  } | null;
  terms: { fundingSompi: string; open: { address: string }; frozen: { address: string } };
  chain: { daa: string; blueScore: string };
  open: { amount: string }[];
  frozen: { amount: string }[];
};
export type StudioState =
  | "checking"
  | "backup"
  | "fund"
  | "mismatch"
  | "active"
  | "drawing"
  | "refund-wait"
  | "refund"
  | "refunding"
  | "refunded"
  | "paid"
  | "closed";
export function studioRefundReady(d: StudioDetail, phase: "open" | "frozen") {
  const threshold =
    d.manifest.version === 4 && phase === "frozen" && d.manifest.entries.length === 0
      ? d.manifest.closesAtDaa
      : d.manifest.refundDaa;
  return (
    BigInt(d.chain.daa) > BigInt(threshold) &&
    d[phase].some((e) => BigInt(e.amount) > BigInt(d.manifest.drawFeeSompi))
  );
}
export function studioState(d: StudioDetail, fresh: boolean, backedUp: boolean): StudioState {
  if (!fresh) return "checking";
  const hasOutputs = d.open.length > 0 || d.frozen.length > 0;
  if (d.payout?.confirmed && !hasOutputs) return "paid";
  if (d.refund?.confirmed && !hasOutputs) return "refunded";
  if (d.refund && !d.refund.confirmed) return "refunding";
  if (d.payout && !d.payout.confirmed) return "drawing";
  if (studioRefundReady(d, "open") || studioRefundReady(d, "frozen")) return "refund";
  const closed = BigInt(d.chain.daa) >= BigInt(d.manifest.closesAtDaa);
  if (closed) {
    if (!hasOutputs) return "closed";
    if (d.entryCount === 0) return "refund-wait";
    if (BigInt(d.chain.daa) >= BigInt(d.manifest.refundDaa)) return "closed";
    return "drawing";
  }
  if (d.frozen.length) return "drawing";
  if (d.open.some((e) => e.amount === d.terms.fundingSompi)) return "active";
  if (hasOutputs) return "mismatch";
  return backedUp ? "fund" : "backup";
}
export function studioStep(state: StudioState) {
  return state === "backup" ? 1 : state === "fund" || state === "mismatch" ? 2 : 3;
}
export function remainingTime(target: string, current: string): string {
  const seconds = Math.max(0, Math.ceil(Number(BigInt(target) - BigInt(current)) / 10));
  if (seconds < 60) return "less than a minute";
  const minutes = Math.ceil(seconds / 60);
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}
