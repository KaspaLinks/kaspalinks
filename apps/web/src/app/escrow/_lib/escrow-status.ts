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
  auto_released: { label: "Released", tone: "success" },
  awaiting_buyer_payment: { label: "Awaiting payment", tone: "waiting" },
  awaiting_seller_deposit: { label: "Awaiting seller deposit", tone: "waiting" },
  cancelled: { label: "Cancelled", tone: "closed" },
  expired: { label: "Expired", tone: "closed" },
  frozen: { label: "Frozen", tone: "attention" },
  funded: { label: "Funds locked", tone: "active" },
  released: { label: "Completed", tone: "success" },
  settled: { label: "Settled", tone: "success" },
  shipped: { label: "Shipped", tone: "active" },
};

export const ESCROW_STATUSES = Object.keys(ESCROW_STATUS_META) as EscrowStatus[];

const CLOSED_STATUSES: ReadonlySet<EscrowStatus> = new Set([
  "auto_released",
  "cancelled",
  "expired",
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
  if (remainingMs <= 0) {
    return { label: "Deadline passed", passed: true };
  }

  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 1) {
    return { label: "less than a minute", passed: false };
  }

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
  | "lock_deposit"
  | "mark_shipped"
  | "pay"
  | "refund_buyer"
  | "release"
  | "settle";

/**
 * Which spend paths a party can take. Mirrors the escrow model: the buyer can
 * release or freeze before the deadline, the seller can refund at any time or
 * claim once the deadline has passed, and a frozen escrow only moves when both
 * sign the same split.
 */
export function getEscrowActions(
  status: EscrowStatus,
  role: EscrowRole,
  deadlinePassed: boolean,
): EscrowActionId[] {
  switch (status) {
    case "awaiting_seller_deposit":
      return role === "seller" ? ["lock_deposit", "cancel_link"] : [];
    case "awaiting_buyer_payment":
      return role === "seller" ? ["cancel_link"] : ["pay"];
    case "funded":
    case "shipped": {
      if (role === "buyer") {
        return deadlinePassed ? ["release"] : ["release", "freeze"];
      }
      const sellerActions: EscrowActionId[] =
        status === "funded" ? ["mark_shipped", "refund_buyer"] : ["refund_buyer"];
      return deadlinePassed ? ["claim_after_deadline", ...sellerActions] : sellerActions;
    }
    case "frozen":
      return ["settle"];
    case "auto_released":
    case "cancelled":
    case "expired":
    case "released":
    case "settled":
      return [];
  }
}

export type EscrowTransition =
  | { buyerAddressLabel: string; type: "pay" }
  | { buyerSompi: bigint; sellerSompi: bigint; type: "settle" }
  | { carrier: string; trackingNumber: string; type: "mark_shipped" }
  | { note: string; reason: EscrowFreezeReason; type: "freeze" }
  | { type: "cancel_link" | "claim_after_deadline" | "lock_deposit" | "refund_buyer" | "release" };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local prototype state machine. Throws when a party picks a path that is not open to them. */
export function applyEscrowTransition(
  deal: EscrowDeal,
  role: EscrowRole,
  transition: EscrowTransition,
  nowMs: number,
): EscrowDeal {
  const allowed = getEscrowActions(deal.status, role, isDeadlinePassed(deal, nowMs));
  if (!allowed.includes(transition.type)) {
    throw new Error(`"${transition.type}" is not available to the ${role} while ${deal.status}.`);
  }

  const now = new Date(nowMs).toISOString();

  switch (transition.type) {
    case "lock_deposit":
      return { ...deal, status: "awaiting_buyer_payment" };
    case "cancel_link":
      return { ...deal, closedAt: now, status: "cancelled" };
    case "pay":
      return {
        ...deal,
        buyerAddressLabel: transition.buyerAddressLabel,
        fundedAt: now,
        releaseDeadline: new Date(nowMs + deal.releaseWindowDays * DAY_MS).toISOString(),
        status: "funded",
      };
    case "mark_shipped":
      return {
        ...deal,
        shipment: {
          carrier: transition.carrier,
          shippedAt: now,
          trackingNumber: transition.trackingNumber,
        },
        status: "shipped",
      };
    case "refund_buyer":
      return { ...deal, closedAt: now, status: "cancelled" };
    case "release":
      return { ...deal, closedAt: now, status: "released" };
    case "claim_after_deadline":
      return { ...deal, closedAt: now, status: "auto_released" };
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
  id: "deposit" | "outcome" | "payment" | "shipment";
  label: string;
  state: EscrowTimelineState;
};

function outcomeStep(deal: EscrowDeal): EscrowTimelineStep {
  switch (deal.status) {
    case "released":
      return { id: "outcome", label: "Released by buyer", state: "done" };
    case "auto_released":
      return { id: "outcome", label: "Released after the deadline", state: "done" };
    case "cancelled":
      return {
        id: "outcome",
        label: deal.fundedAt ? "Refunded by seller" : "Link cancelled",
        state: "done",
      };
    case "settled":
      return { id: "outcome", label: "Settled by agreement", state: "done" };
    case "expired":
      return { id: "outcome", label: "Link expired", state: "done" };
    case "frozen":
      return { id: "outcome", label: "Frozen until both agree", state: "attention" };
    case "shipped":
      return { id: "outcome", label: "Buyer checks and releases", state: "current" };
    case "awaiting_buyer_payment":
    case "awaiting_seller_deposit":
    case "funded":
      return { id: "outcome", label: "Release", state: "upcoming" };
  }
}

export function buildEscrowTimeline(deal: EscrowDeal): EscrowTimelineStep[] {
  const closedOrFrozen = isEscrowClosed(deal.status) || deal.status === "frozen";

  const deposit: EscrowTimelineStep = {
    id: "deposit",
    label: deal.depositRateBps === 0 ? "Link activated" : "Seller deposit locked",
    state: deal.status === "awaiting_seller_deposit" ? "current" : "done",
  };

  const payment: EscrowTimelineStep = {
    id: "payment",
    label: "Buyer payment locked",
    state:
      deal.status === "awaiting_seller_deposit"
        ? "upcoming"
        : deal.status === "awaiting_buyer_payment"
          ? "current"
          : deal.fundedAt
            ? "done"
            : "skipped",
  };

  const shipment: EscrowTimelineStep = {
    id: "shipment",
    label: deal.shipment
      ? "Shipped"
      : deal.status === "funded"
        ? "Seller prepares shipment"
        : "Shipment",
    state: deal.shipment
      ? "done"
      : deal.status === "funded"
        ? "current"
        : closedOrFrozen
          ? "skipped"
          : "upcoming",
  };

  return [deposit, payment, shipment, outcomeStep(deal)];
}
