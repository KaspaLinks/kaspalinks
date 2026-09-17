import { formatSompiToKaspa, parseKaspaAmountToSompi } from "@kaspa-actions/kaspa/amount";

import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";

import type { EscrowDeal, EscrowDepositRateBps } from "./escrow-types";

const BPS_DENOMINATOR = 10_000n;

export type EscrowAmounts = {
  buyerDepositSompi: bigint;
  buyerLockSompi: bigint;
  itemTotalSompi: bigint;
  priceSompi: bigint;
  sellerDepositSompi: bigint;
  shippingSompi: bigint;
  totalLockedSompi: bigint;
};

export type EscrowPayout = {
  buyerSompi: bigint;
  sellerSompi: bigint;
};

export function computeDepositSompi(
  itemTotalSompi: bigint,
  depositRateBps: EscrowDepositRateBps,
): bigint {
  return (itemTotalSompi * BigInt(depositRateBps)) / BPS_DENOMINATOR;
}

export function computeEscrowAmounts(
  deal: Pick<EscrowDeal, "depositRateBps" | "priceSompi" | "shippingSompi">,
): EscrowAmounts {
  const itemTotalSompi = deal.priceSompi + deal.shippingSompi;
  const depositSompi = computeDepositSompi(itemTotalSompi, deal.depositRateBps);
  const buyerLockSompi = itemTotalSompi + depositSompi;

  return {
    buyerDepositSompi: depositSompi,
    buyerLockSompi,
    itemTotalSompi,
    priceSompi: deal.priceSompi,
    sellerDepositSompi: depositSompi,
    shippingSompi: deal.shippingSompi,
    totalLockedSompi: buyerLockSompi + depositSompi,
  };
}

/** Release pays the item total to the seller; each side gets its own deposit back. */
export function releasePayout(amounts: EscrowAmounts): EscrowPayout {
  return {
    buyerSompi: amounts.buyerDepositSompi,
    sellerSompi: amounts.itemTotalSompi + amounts.sellerDepositSompi,
  };
}

/** A seller refund returns everything each side locked. */
export function refundPayout(amounts: EscrowAmounts): EscrowPayout {
  return {
    buyerSompi: amounts.buyerLockSompi,
    sellerSompi: amounts.sellerDepositSompi,
  };
}

/** Splits the frozen total so each side gets its own deposit plus half the item total. */
export function evenSplitPayout(amounts: EscrowAmounts): EscrowPayout {
  const buyerSompi = amounts.buyerDepositSompi + amounts.itemTotalSompi / 2n;
  return { buyerSompi, sellerSompi: amounts.totalLockedSompi - buyerSompi };
}

/** What each side received once an escrow is closed, or null while it is still open. */
export function outcomePayout(
  deal: Pick<
    EscrowDeal,
    "depositRateBps" | "fundedAt" | "priceSompi" | "settlement" | "shippingSompi" | "status"
  >,
): EscrowPayout | null {
  const amounts = computeEscrowAmounts(deal);

  switch (deal.status) {
    case "released":
    case "auto_released":
      return releasePayout(amounts);
    case "cancelled":
      return deal.fundedAt
        ? refundPayout(amounts)
        : { buyerSompi: 0n, sellerSompi: amounts.sellerDepositSompi };
    case "expired":
      return { buyerSompi: 0n, sellerSompi: amounts.sellerDepositSompi };
    case "settled":
      return deal.settlement
        ? { buyerSompi: deal.settlement.buyerSompi, sellerSompi: deal.settlement.sellerSompi }
        : null;
    case "awaiting_buyer_payment":
    case "awaiting_seller_deposit":
    case "frozen":
    case "funded":
    case "shipped":
      return null;
  }
}

/** KAS for display: grouped whole part, up to 8 decimals, zero allowed. */
export function formatKasAmount(sompi: bigint): string {
  if (sompi < 0n) {
    throw new Error("KAS display amount must not be negative.");
  }
  if (sompi === 0n) {
    return "0";
  }

  const [wholePart = "0", decimalPart] = formatSompiToKaspa(sompi).split(".");
  const groupedWhole = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart ? `${groupedWhole}.${decimalPart}` : groupedWhole;
}

/** Plain decimal KAS string (no grouping) for wallet- and price-helper inputs. */
export function toPlainKas(sompi: bigint): string {
  return sompi === 0n ? "0" : formatSompiToKaspa(sompi);
}

export type ParsedKasInput = { ok: true; sompi: bigint } | { message: string; ok: false };

export function parseKasInput(rawValue: string, options: { allowZero: boolean }): ParsedKasInput {
  const value = normalizeLocalizedKasAmountInput(rawValue.trim());

  if (value.length === 0) {
    return { message: "Enter an amount in KAS.", ok: false };
  }
  if (options.allowZero && /^0+(?:\.0+)?$/.test(value)) {
    return { ok: true, sompi: 0n };
  }

  try {
    return { ok: true, sompi: parseKaspaAmountToSompi(value) };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Enter a valid KAS amount.",
      ok: false,
    };
  }
}

export type SettlementSplit =
  | { buyerSompi: bigint; ok: true; sellerSompi: bigint }
  | { message: string; ok: false };

/** A settlement must hand out exactly what is locked — nothing more, nothing less. */
export function splitSettlement(buyerKasInput: string, totalLockedSompi: bigint): SettlementSplit {
  const parsed = parseKasInput(buyerKasInput, { allowZero: true });
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.sompi > totalLockedSompi) {
    return {
      message: `The buyer share cannot exceed the ${formatKasAmount(totalLockedSompi)} KAS locked in escrow.`,
      ok: false,
    };
  }

  return {
    buyerSompi: parsed.sompi,
    ok: true,
    sellerSompi: totalLockedSompi - parsed.sompi,
  };
}
