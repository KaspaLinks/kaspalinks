import { formatSompiToKaspa, parseKaspaAmountToSompi } from "@kaspa-actions/kaspa/amount";

import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";

import type { EscrowDeal } from "./escrow-types";

export type EscrowAmounts = {
  buyerLockSompi: bigint;
  itemTotalSompi: bigint;
  priceSompi: bigint;
  shippingSompi: bigint;
  totalLockedSompi: bigint;
};

export type EscrowPayout = {
  buyerSompi: bigint;
  sellerSompi: bigint;
};

export function computeEscrowAmounts(
  deal: Pick<EscrowDeal, "priceSompi" | "shippingSompi">,
): EscrowAmounts {
  const itemTotalSompi = deal.priceSompi + deal.shippingSompi;

  return {
    buyerLockSompi: itemTotalSompi,
    itemTotalSompi,
    priceSompi: deal.priceSompi,
    shippingSompi: deal.shippingSompi,
    totalLockedSompi: itemTotalSompi,
  };
}

/** Release pays the buyer-funded item total to the seller. */
export function releasePayout(amounts: EscrowAmounts): EscrowPayout {
  return {
    buyerSompi: 0n,
    sellerSompi: amounts.itemTotalSompi,
  };
}

/** A seller refund returns the complete buyer-funded output. */
export function refundPayout(amounts: EscrowAmounts): EscrowPayout {
  return {
    buyerSompi: amounts.buyerLockSompi,
    sellerSompi: 0n,
  };
}

/** Splits the frozen buyer-funded total in half. */
export function evenSplitPayout(amounts: EscrowAmounts): EscrowPayout {
  const buyerSompi = amounts.itemTotalSompi / 2n;
  return { buyerSompi, sellerSompi: amounts.totalLockedSompi - buyerSompi };
}

/** What each side received once an escrow is closed, or null while it is still open. */
export function outcomePayout(
  deal: Pick<EscrowDeal, "fundedAt" | "priceSompi" | "settlement" | "shippingSompi" | "status">,
): EscrowPayout | null {
  const amounts = computeEscrowAmounts(deal);

  switch (deal.status) {
    case "released":
    case "claimed":
      return releasePayout(amounts);
    case "refunded":
      return refundPayout(amounts);
    case "cancelled_unfunded":
      return { buyerSompi: 0n, sellerSompi: 0n };
    case "settled":
      return deal.settlement
        ? { buyerSompi: deal.settlement.buyerSompi, sellerSompi: deal.settlement.sellerSompi }
        : null;
    case "draft":
    case "awaiting_buyer":
    case "awaiting_funding":
    case "frozen":
    case "active":
    case "unknown_spend":
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
