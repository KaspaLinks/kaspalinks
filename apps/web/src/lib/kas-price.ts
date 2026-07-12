const COINGECKO_KAS_USD_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=kaspa&vs_currencies=usd&include_last_updated_at=true";
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const PRICE_FETCH_TIMEOUT_MS = 5_000;

export type KasUsdPrice = {
  approximate: true;
  fetchedAt: string;
  kasUsd: string;
  lastUpdatedAt: null | string;
  source: "coingecko";
  stale: boolean;
};

type CacheEntry = {
  expiresAtMs: number;
  price: KasUsdPrice;
};

type CoinGeckoSimplePriceResponse = {
  kaspa?: {
    last_updated_at?: unknown;
    usd?: unknown;
  };
};

let cache: CacheEntry | null = null;

export async function getKasUsdPrice(options?: {
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<KasUsdPrice> {
  const now = options?.now ?? new Date();
  const nowMs = now.getTime();

  if (cache && cache.expiresAtMs > nowMs) {
    return cache.price;
  }

  try {
    const price = await fetchKasUsdPrice(options?.fetchImpl ?? fetch, now);
    cache = {
      expiresAtMs: nowMs + PRICE_CACHE_TTL_MS,
      price,
    };
    return price;
  } catch (error) {
    if (cache) {
      return { ...cache.price, stale: true };
    }
    throw error;
  }
}

export function resetKasUsdPriceCacheForTests(): void {
  cache = null;
}

async function fetchKasUsdPrice(fetchImpl: typeof fetch, now: Date): Promise<KasUsdPrice> {
  const response = await fetchImpl(COINGECKO_KAS_USD_URL, {
    headers: {
      accept: "application/json",
      "user-agent": "KaspaLinks/0.1 (+https://kaspalinks.com)",
    },
    signal: AbortSignal.timeout(PRICE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`KAS price fetch failed with HTTP ${response.status}.`);
  }

  const body = (await response.json()) as CoinGeckoSimplePriceResponse;
  const usd = body.kaspa?.usd;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    throw new Error("KAS price response did not include a valid USD price.");
  }

  const updatedAt = body.kaspa?.last_updated_at;
  const lastUpdatedAt =
    typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt > 0
      ? new Date(updatedAt * 1000).toISOString()
      : null;

  return {
    approximate: true,
    fetchedAt: now.toISOString(),
    kasUsd: usd.toString(),
    lastUpdatedAt,
    source: "coingecko",
    stale: false,
  };
}
