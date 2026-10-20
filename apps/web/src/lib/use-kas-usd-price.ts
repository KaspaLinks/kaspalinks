"use client";

import { useEffect, useState } from "react";

export type KasUsdPriceState = {
  kasEur: null | string;
  kasUsd: string;
  stale: boolean;
};

type PriceApiResponse = {
  price?: {
    kasEur?: unknown;
    kasUsd?: unknown;
    stale?: unknown;
  };
};

// One request per page view, shared by every amount that shows a fiat value.
let pending: null | Promise<KasUsdPriceState | null> = null;
let pendingAtMs = 0;
const SHARE_MS = 5 * 60 * 1000;

function loadPrice(): Promise<KasUsdPriceState | null> {
  if (pending && Date.now() - pendingAtMs < SHARE_MS) return pending;
  pendingAtMs = Date.now();
  pending = fetch("/api/price/kas-usd")
    .then(async (response) => {
      if (!response.ok) return null;
      const body = (await response.json()) as PriceApiResponse;
      const kasUsd = body.price?.kasUsd;
      if (typeof kasUsd !== "string") return null;
      const kasEur = body.price?.kasEur;
      return {
        kasEur: typeof kasEur === "string" ? kasEur : null,
        kasUsd,
        stale: body.price?.stale === true,
      };
    })
    .catch(() => null);
  // A failed load may be retried by the next component.
  void pending.then((price) => {
    if (!price) pending = null;
  });
  return pending;
}

export function useKasUsdPrice(): KasUsdPriceState | null {
  const [price, setPrice] = useState<KasUsdPriceState | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPrice().then((loaded) => {
      if (!cancelled) setPrice(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}
