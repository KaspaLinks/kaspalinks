import { createRestKaspaIndexer, type KaspaIndexer } from "@kaspa-actions/kaspa-indexer";

export type IndexerNetwork = "mainnet" | "testnet";

type IndexerCache = Partial<Record<IndexerNetwork, KaspaIndexer | null>>;
type IndexerMode = "cached" | "realtime";

const cacheByMode: Record<IndexerMode, IndexerCache> = {
  cached: {},
  realtime: {},
};
const initializedByMode: Record<IndexerMode, Partial<Record<IndexerNetwork, boolean>>> = {
  cached: {},
  realtime: {},
};
const initErrorsLogged: Partial<Record<IndexerNetwork, boolean>> = {};

const DEFAULT_MAINNET_URL = "https://api.kaspa.org";

export function isChainDetectionEnabled(value = process.env.KASPA_INDEXER_ENABLED): boolean {
  return value === "true";
}

function urlFor(network: IndexerNetwork): null | string {
  // Per-network env vars take precedence.
  if (network === "mainnet") {
    const mainnet = process.env.KASPA_MAINNET_INDEXER_URL?.trim();
    if (mainnet) return mainnet;
    // Backward compat: KASPA_INDEXER_URL applied to mainnet only.
    const legacy = process.env.KASPA_INDEXER_URL?.trim();
    if (legacy) return legacy;
    return DEFAULT_MAINNET_URL;
  }

  const testnet = process.env.KASPA_TESTNET_INDEXER_URL?.trim();
  return testnet && testnet.length > 0 ? testnet : null;
}

function providerIdFor(network: IndexerNetwork): string | undefined {
  if (network === "mainnet") {
    const override =
      process.env.KASPA_MAINNET_INDEXER_PROVIDER_ID?.trim() ||
      process.env.KASPA_INDEXER_PROVIDER_ID?.trim();
    return override && override.length > 0 ? override : undefined;
  }
  const override = process.env.KASPA_TESTNET_INDEXER_PROVIDER_ID?.trim();
  return override && override.length > 0 ? override : undefined;
}

export function getKaspaIndexer(network: IndexerNetwork): KaspaIndexer | null {
  return getConfiguredIndexer(network, "cached");
}

/**
 * Fresh indexer reads for the payment-confirmation hot path.
 * Dashboard/receipt views use the cached indexer above, but a pending payment
 * should not wait on a stale 30-second address snapshot after the wallet has
 * already broadcast a tx.
 */
export function getRealtimeKaspaIndexer(network: IndexerNetwork): KaspaIndexer | null {
  return getConfiguredIndexer(network, "realtime");
}

function getConfiguredIndexer(network: IndexerNetwork, mode: IndexerMode): KaspaIndexer | null {
  if (!isChainDetectionEnabled()) {
    return null;
  }

  const cache = cacheByMode[mode];
  const initialized = initializedByMode[mode];

  if (initialized[network]) {
    return cache[network] ?? null;
  }

  initialized[network] = true;

  const baseUrl = urlFor(network);
  if (!baseUrl) {
    if (!initErrorsLogged[network]) {
      // Not an error per se — testnet detection is opt-in.
      console.info(`Kaspa indexer for ${network} is not configured; chain detection skipped.`);
      initErrorsLogged[network] = true;
    }
    cache[network] = null;
    return null;
  }

  try {
    cache[network] = createRestKaspaIndexer({
      baseUrl,
      ...(mode === "cached"
        ? {
            // Share upstream responses for dashboard / receipt views. The
            // realtime payment status path intentionally omits this so a just-
            // broadcast tx is not hidden behind a stale cached snapshot.
            cacheRevalidateSeconds: 30,
          }
        : {}),
      providerId: providerIdFor(network),
    });
  } catch (error) {
    if (!initErrorsLogged[network]) {
      console.error(
        `Kaspa indexer initialization for ${network} failed:`,
        (error as Error).message,
      );
      initErrorsLogged[network] = true;
    }
    cache[network] = null;
  }

  return cache[network] ?? null;
}

/** Test helper: clears the per-network cache. */
export function resetKaspaIndexerForTests(): void {
  for (const mode of ["cached", "realtime"] as const) {
    for (const key of ["mainnet", "testnet"] as const) {
      delete initializedByMode[mode][key];
      delete cacheByMode[mode][key];
    }
  }
  for (const key of ["mainnet", "testnet"] as const) {
    delete initErrorsLogged[key];
  }
}
