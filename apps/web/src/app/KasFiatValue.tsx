"use client";

import React from "react";

import { formatApproxFiatValue } from "@/lib/price-display";
import { useKasUsdPrice } from "@/lib/use-kas-usd-price";

/** "≈ $3.60 · €3.10" under a KAS amount, or nothing while no price is known. */
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
  const value = formatApproxFiatValue(amountKas, price);
  if (!value) return null;
  return inline ? <span className={className}>{value}</span> : <p className={className}>{value}</p>;
}
