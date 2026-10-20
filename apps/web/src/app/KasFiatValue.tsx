"use client";

import React from "react";

import { formatApproxFiatValue, formatPriceTime } from "@/lib/price-display";
import { useKasUsdPrice } from "@/lib/use-kas-usd-price";

/**
 * "≈ $3.60 · €3.10" under a KAS amount, or nothing while no price is known.
 * An old price says when it is from.
 */
export function KasFiatValue({
  amountKas,
  className = "amount-usd-estimate",
  inline = false,
}: {
  amountKas: null | string | undefined;
  className?: string;
  inline?: boolean;
}) {
  const price = useKasUsdPrice();
  const approx = formatApproxFiatValue(amountKas, price);
  if (!approx) return null;
  const value = price?.old ? `${approx} · price from ${formatPriceTime(price.pricedAtMs)}` : approx;
  return inline ? <span className={className}>{value}</span> : <p className={className}>{value}</p>;
}
