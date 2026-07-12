"use client";

import { useEffect, useState } from "react";

export type KasUsdPriceState = {
  kasUsd: string;
  stale: boolean;
};

type PriceApiResponse = {
  price?: {
    kasUsd?: unknown;
    stale?: unknown;
  };
};

export function useKasUsdPrice(): KasUsdPriceState | null {
  const [price, setPrice] = useState<KasUsdPriceState | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/price/kas-usd")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as PriceApiResponse;
      })
      .then((body) => {
        const kasUsd = body?.price?.kasUsd;
        if (cancelled || typeof kasUsd !== "string") return;
        setPrice({
          kasUsd,
          stale: body?.price?.stale === true,
        });
      })
      .catch(() => {
        if (!cancelled) setPrice(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}
