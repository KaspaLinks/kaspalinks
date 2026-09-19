import { computeEscrowAmounts } from "./escrow-amounts";
import type {
  EscrowCondition,
  EscrowDeal,
  EscrowFreezeReason,
  EscrowRole,
  EscrowStatus,
} from "./escrow-types";

export type EscrowStatusTone = "active" | "attention" | "closed" | "success" | "waiting";

export const ESCROW_STATUS_META: Record<EscrowStatus, { label: string; tone: EscrowStatusTone }> = {
  active: { label: "Funds locked", tone: "active" },
  awaiting_buyer: { label: "Awaiting buyer", tone: "waiting" },
  awaiting_funding: { label: "Awaiting funding", tone: "waiting" },
  cancelled_unfunded: { label: "Cancelled", tone: "closed" },
  claimed: { label: "Claimed after deadline", tone: "success" },
  draft: { label: "Draft", tone: "waiting" },
  frozen: { label: "Frozen", tone: "attention" },
  refunded: { label: "Buyer refunded", tone: "success" },
  released: { label: "Released by buyer", tone: "success" },
  settled: { label: "Settled", tone: "success" },
  unknown_spend: { label: "Unknown spend", tone: "attention" },
};

export const ESCROW_STATUSES = Object.keys(ESCROW_STATUS_META) as EscrowStatus[];

const CLOSED_STATUSES: ReadonlySet<EscrowStatus> = new Set([
  "cancelled_unfunded",
  "claimed",
  "refunded",
  "released",
  "settled",
]);

export function isEscrowClosed(status: EscrowStatus): boolean {
  return CLOSED_STATUSES.has(status);
}

export const ESCROW_CONDITION_LABEL: Record<EscrowCondition, string> = {
  for_parts: "For parts",
  like_new: "Like new",
  new: "New",
  used: "Used",
};

export const ESCROW_FREEZE_REASONS: ReadonlyArray<{ label: string; value: EscrowFreezeReason }> = [
  { label: "Package not received", value: "not_received" },
  { label: "Item not as described", value: "not_as_described" },
  { label: "Wrong item", value: "wrong_item" },
  { label: "Damaged item", value: "damaged" },
  { label: "Missing parts", value: "missing_parts" },
  { label: "Other", value: "other" },
];

export function freezeReasonLabel(reason: EscrowFreezeReason): string {
  return ESCROW_FREEZE_REASONS.find((option) => option.value === reason)?.label ?? "Other";
}

export function isDeadlinePassed(
  deal: Pick<EscrowDeal, "releaseDeadline">,
  nowMs: number,
): boolean {
  return deal.releaseDeadline !== null && Date.parse(deal.releaseDeadline) <= nowMs;
}

export type TimeRemaining = { label: string; passed: boolean };

export function getTimeRemaining(deadlineIso: string, nowMs: number): TimeRemaining {
  const remainingMs = Date.parse(deadlineIso) - nowMs;
  if (remainingMs <= 0) return { label: "Deadline passed", passed: true };

  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 1) return { label: "less than a minute", passed: false };

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours >= 72) {
    return { label: `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`, passed: false };
  }
  return { label: `${totalHours}h ${totalMinutes % 60}m`, passed: false };
}

export type EscrowActionId =
  | "cancel_link"
  | "claim_after_deadline"
  | "freeze"
  | "mark_shipped"
  | "pay"
  | "refund_buyer"
  | "release"
  | "settle";

export function getEscrowActions(
  status: EscrowStatus,
  role: EscrowRole,
  deadlinePassed: boolean,
  hasShipment = false,
): EscrowActionId[] {
  switch (status) {
    case "draft":
    case "awaiting_buyer":
      return role === "seller" ? ["cancel_link"] : [];
    case "awaiting_funding":
      return role === "seller" ? ["cancel_link"] : ["pay"];
    case "active": {
      if (role === "buyer") return ["release", "freeze"];
      const actions: EscrowActionId[] = hasShipment
        ? ["refund_buyer"]
        : ["mark_shipped", "refund_buyer"];
      return deadlinePassed ? ["claim_after_deadline", ...actions] : actions;
    }
    case "frozen":
      return role === "seller" ? ["refund_buyer", "settle"] : ["settle"];
    case "cancelled_unfunded":
    case "claimed":
    case "refunded":
    case "released":
    case "settled":
    case "unknown_spend":
      return [];
  }
}

export type EscrowTransition =
  | { buyerAddressLabel: string; type: "pay" }
  | { buyerSompi: bigint; sellerSompi: bigint; type: "settle" }
  | { carrier: string; trackingNumber: string; type: "mark_shipped" }
  | { note: string; reason: EscrowFreezeReason; type: "freeze" }
  | { type: "cancel_link" | "claim_after_deadline" | "refund_buyer" | "release" };

const DAY_MS = 24 * 60 * 60 * 1000;

export function applyEscrowTransition(
  deal: EscrowDeal,
  role: EscrowRole,
  transition: EscrowTransition,
  nowMs: number,
): EscrowDeal {
  const allowed = getEscrowActions(
    deal.status,
    role,
    isDeadlinePassed(deal, nowMs),
    deal.shipment !== null,
  );
  if (!allowed.includes(transition.type)) {
    throw new Error(`"${transition.type}" is not available to the ${role} while ${deal.status}.`);
  }

  const now = new Date(nowMs).toISOString();
  switch (transition.type) {
    case "cancel_link":
      return { ...deal, closedAt: now, status: "cancelled_unfunded" };
    case "pay":
      return {
        ...deal,
        buyerAddressLabel: transition.buyerAddressLabel,
        fundedAt: now,
        releaseDeadline: new Date(nowMs + deal.releaseWindowDays * DAY_MS).toISOString(),
        status: "active",
      };
    case "mark_shipped":
      return {
        ...deal,
        shipment: {
          carrier: transition.carrier,
          shippedAt: now,
          trackingNumber: transition.trackingNumber,
        },
      };
    case "refund_buyer":
      return { ...deal, closedAt: now, status: "refunded" };
    case "release":
      return { ...deal, closedAt: now, status: "released" };
    case "claim_after_deadline":
      return { ...deal, closedAt: now, status: "claimed" };
    case "freeze":
      return {
        ...deal,
        freeze: { frozenAt: now, note: transition.note, reason: transition.reason },
        status: "frozen",
      };
    case "settle": {
      const { totalLockedSompi } = computeEscrowAmounts(deal);
      if (transition.buyerSompi + transition.sellerSompi !== totalLockedSompi) {
        throw new Error("A settlement must pay out exactly the locked amount.");
      }
      return {
        ...deal,
        closedAt: now,
        settlement: {
          buyerSompi: transition.buyerSompi,
          sellerSompi: transition.sellerSompi,
          settledAt: now,
        },
        status: "settled",
      };
    }
  }
}

export type EscrowTimelineState = "attention" | "current" | "done" | "skipped" | "upcoming";
export type EscrowTimelineStep = {
  id: "link" | "outcome" | "payment" | "shipment";
  label: string;
  state: EscrowTimelineState;
};

function outcomeStep(deal: EscrowDeal): EscrowTimelineStep {
  switch (deal.status) {
    case "released":
      return { id: "outcome", label: "Released by buyer", state: "done" };
    case "claimed":
      return { id: "outcome", label: "Claimed by seller after deadline", state: "done" };
    case "refunded":
      return { id: "outcome", label: "Refunded by seller", state: "done" };
    case "cancelled_unfunded":
      return { id: "outcome", label: "Link cancelled", state: "done" };
    case "settled":
      return { id: "outcome", label: "Settled by agreement", state: "done" };
    case "unknown_spend":
      return { id: "outcome", label: "Spend needs review", state: "attention" };
    case "frozen":
      return { id: "outcome", label: "Frozen until both agree", state: "attention" };
    case "active":
      return {
        id: "outcome",
        label: "Release or claim",
        state: deal.shipment ? "current" : "upcoming",
      };
    case "draft":
    case "awaiting_buyer":
    case "awaiting_funding":
      return { id: "outcome", label: "Release", state: "upcoming" };
  }
}

export function buildEscrowTimeline(deal: EscrowDeal): EscrowTimelineStep[] {
  const ended =
    isEscrowClosed(deal.status) || deal.status === "frozen" || deal.status === "unknown_spend";
  const link: EscrowTimelineStep = {
    id: "link",
    label: "Escrow terms ready",
    state: deal.status === "draft" ? "current" : "done",
  };
  const payment: EscrowTimelineStep = {
    id: "payment",
    label: "Buyer payment locked",
    state:
      deal.status === "awaiting_buyer" || deal.status === "draft"
        ? "upcoming"
        : deal.status === "awaiting_funding"
          ? "current"
          : deal.fundedAt
            ? "done"
            : "skipped",
  };
  const shipment: EscrowTimelineStep = {
    id: "shipment",
    label: deal.shipment
      ? "Shipped"
      : deal.status === "active"
        ? "Seller prepares shipment"
        : "Shipment",
    state: deal.shipment
      ? "done"
      : deal.status === "active"
        ? "current"
        : ended
          ? "skipped"
          : "upcoming",
  };
  return [link, payment, shipment, outcomeStep(deal)];
}
