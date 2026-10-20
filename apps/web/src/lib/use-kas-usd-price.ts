"use client";

import { useEffect, useState } from "react";

export type KasUsdPriceState = {
  kasEur: null | string;
  kasUsd: string;
  /**
   * Older than PRICE_INPUT_MAX_AGE_MS: still shown as an estimate, but no
   * longer used to turn $ or € input into KAS.
   */
  old: boolean;
  /** When the price was quoted (CoinGecko's update time, else the server fetch). */
  pricedAtMs: number;
  stale: boolean;
};

type PriceApiResponse = {
  price?: {
    fetchedAt?: unknown;
    kasEur?: unknown;
    kasUsd?: unknown;
    lastUpdatedAt?: unknown;
    stale?: unknown;
  };
};

/** Open pages fetch a new price this often while they are visible. */
export const PRICE_REFRESH_MS = 5 * 60 * 1000;
export const PRICE_INPUT_MAX_AGE_MS = 30 * 60 * 1000;
const CHECK_MS = 30 * 1000;
const RETRY_MS = 60 * 1000;

function parseTime(value: unknown): null | number {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function parseKasUsdPriceResponse(body: unknown, nowMs: number): KasUsdPriceState | null {
  const price = (body as PriceApiResponse | null)?.price;
  if (!price || typeof price.kasUsd !== "string") return null;
  const pricedAtMs = parseTime(price.lastUpdatedAt) ?? parseTime(price.fetchedAt) ?? nowMs;
  return {
    kasEur: typeof price.kasEur === "string" ? price.kasEur : null,
    kasUsd: price.kasUsd,
    old: nowMs - pricedAtMs > PRICE_INPUT_MAX_AGE_MS,
    pricedAtMs,
    stale: price.stale === true,
  };
}

// One price per page, shared by every amount on it and refreshed while the
// page stays open, so a form left open for an hour does not convert with an
// hour-old price.
let current: KasUsdPriceState | null = null;
let nextFetchAtMs = 0;
let inflight = false;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(price: KasUsdPriceState | null) => void>();

function publish(price: KasUsdPriceState | null) {
  current = price;
  for (const listener of listeners) listener(price);
}

function refresh() {
  if (inflight || Date.now() < nextFetchAtMs) return;
  inflight = true;
  void fetch("/api/price/kas-usd")
    .then(async (response) =>
      response.ok ? parseKasUsdPriceResponse(await response.json(), Date.now()) : null,
    )
    .catch(() => null)
    .then((price) => {
      // A failed refresh keeps the last price; it ages until it counts as old.
      nextFetchAtMs = Date.now() + (price ? PRICE_REFRESH_MS : RETRY_MS);
      if (price) publish(price);
    })
    .finally(() => {
      inflight = false;
    });
}

function tick() {
  if (document.visibilityState !== "visible") return;
  if (current && !current.old && Date.now() - current.pricedAtMs > PRICE_INPUT_MAX_AGE_MS) {
    publish({ ...current, old: true });
  }
  refresh();
}

function subscribe(listener: (price: KasUsdPriceState | null) => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(tick, CHECK_MS);
    document.addEventListener("visibilitychange", tick);
  }
  refresh();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", tick);
    }
  };
}

export function useKasUsdPrice(): KasUsdPriceState | null {
  const [price, setPrice] = useState<KasUsdPriceState | null>(null);

  useEffect(() => {
    setPrice(current);
    return subscribe(setPrice);
  }, []);

  return price;
}
