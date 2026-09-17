// Phase 1 escrow links are a UI prototype. These types describe the deal shape
// the screens need; they are not a database or covenant contract yet. See
// docs/escrow-links.md for the escrow model the screens assume.

export type EscrowStatus =
  | "awaiting_seller_deposit"
  | "awaiting_buyer_payment"
  | "funded"
  | "shipped"
  | "released"
  | "auto_released"
  | "cancelled"
  | "frozen"
  | "settled"
  | "expired";

export type EscrowRole = "buyer" | "seller";

export type EscrowCondition = "new" | "like_new" | "used" | "for_parts";

/** Deposit per side, in basis points of the item total (price + shipping). */
export type EscrowDepositRateBps = 0 | 2500 | 5000 | 10000;

export type EscrowReleaseWindowDays = 7 | 14 | 30;

export type EscrowFreezeReason =
  | "not_received"
  | "not_as_described"
  | "wrong_item"
  | "damaged"
  | "missing_parts"
  | "other";

export type EscrowShipment = {
  carrier: string;
  shippedAt: string;
  trackingNumber: string;
};

export type EscrowFreeze = {
  frozenAt: string;
  note: string;
  reason: EscrowFreezeReason;
};

export type EscrowSettlement = {
  buyerSompi: bigint;
  sellerSompi: bigint;
  settledAt: string;
};

export type EscrowDeal = {
  buyerAddressLabel: null | string;
  closedAt: null | string;
  condition: EscrowCondition;
  createdAt: string;
  depositRateBps: EscrowDepositRateBps;
  description: string;
  freeze: EscrowFreeze | null;
  fundedAt: null | string;
  id: string;
  priceSompi: bigint;
  reference: string;
  releaseDeadline: null | string;
  releaseWindowDays: EscrowReleaseWindowDays;
  sellerUsername: string;
  settlement: EscrowSettlement | null;
  shipment: EscrowShipment | null;
  shippingSompi: bigint;
  status: EscrowStatus;
  title: string;
};
