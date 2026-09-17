"use client";

import { formatApproxUsdValue } from "@/lib/price-display";
import { useKasUsdPrice } from "@/lib/use-kas-usd-price";

import { formatKasAmount, toPlainKas } from "../_lib/escrow-amounts";

/** KAS is the authoritative amount; the USD line is a live estimate and stays secondary. */
export function EscrowKasAmount({ label, sompi }: { label: string; sompi: bigint }) {
  const price = useKasUsdPrice();
  const usdEstimate = sompi > 0n ? formatApproxUsdValue(toPlainKas(sompi), price) : null;

  return (
    <div className="escrow-kas-amount">
      <span className="label">{label}</span>
      <div className="amount-display amount-display-large">
        <span className="amount-main">{formatKasAmount(sompi)}</span>
        <span className="amount-unit">KAS</span>
      </div>
      {usdEstimate ? <p className="amount-usd-estimate">{usdEstimate}</p> : null}
    </div>
  );
}
