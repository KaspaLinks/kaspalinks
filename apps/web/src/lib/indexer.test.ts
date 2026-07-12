import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getKaspaIndexer,
  getRealtimeKaspaIndexer,
  isChainDetectionEnabled,
  resetKaspaIndexerForTests,
} from "./indexer";

const ENV_KEYS = [
  "KASPA_INDEXER_ENABLED",
  "KASPA_INDEXER_URL",
  "KASPA_INDEXER_PROVIDER_ID",
  "KASPA_MAINNET_INDEXER_URL",
  "KASPA_MAINNET_INDEXER_PROVIDER_ID",
  "KASPA_TESTNET_INDEXER_URL",
  "KASPA_TESTNET_INDEXER_PROVIDER_ID",
] as const;

const ORIGINAL: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
for (const key of ENV_KEYS) ORIGINAL[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
  resetKaspaIndexerForTests();
  vi.restoreAllMocks();
});

describe("isChainDetectionEnabled", () => {
  it("returns true only for the literal string 'true'", () => {
    expect(isChainDetectionEnabled("true")).toBe(true);
    expect(isChainDetectionEnabled("True")).toBe(false);
    expect(isChainDetectionEnabled("yes")).toBe(false);
    expect(isChainDetectionEnabled("1")).toBe(false);
    expect(isChainDetectionEnabled(undefined)).toBe(false);
    expect(isChainDetectionEnabled("")).toBe(false);
  });
});

describe("getKaspaIndexer", () => {
  it("returns null when chain detection is disabled", () => {
    process.env.KASPA_INDEXER_ENABLED = "false";
    resetKaspaIndexerForTests();
    expect(getKaspaIndexer("mainnet")).toBeNull();
    expect(getKaspaIndexer("testnet")).toBeNull();
  });

  it("uses KASPA_MAINNET_INDEXER_URL when set", () => {
    process.env.KASPA_INDEXER_ENABLED = "true";
    process.env.KASPA_MAINNET_INDEXER_URL = "https://api.kaspa.org";
    process.env.KASPA_MAINNET_INDEXER_PROVIDER_ID = "rest:mainnet-custom";
    resetKaspaIndexerForTests();

    expect(getKaspaIndexer("mainnet")?.providerId).toBe("rest:mainnet-custom");
    expect(getRealtimeKaspaIndexer("mainnet")?.providerId).toBe("rest:mainnet-custom");
  });

  it("falls back to legacy KASPA_INDEXER_URL for mainnet", () => {
    process.env.KASPA_INDEXER_ENABLED = "true";
    delete process.env.KASPA_MAINNET_INDEXER_URL;
    process.env.KASPA_INDEXER_URL = "https://legacy.example.com";
    resetKaspaIndexerForTests();

    const indexer = getKaspaIndexer("mainnet");
    expect(indexer?.providerId).toBe("rest:legacy.example.com");
  });

  it("returns null for testnet when no testnet indexer is configured", () => {
    process.env.KASPA_INDEXER_ENABLED = "true";
    delete process.env.KASPA_TESTNET_INDEXER_URL;
    resetKaspaIndexerForTests();
    expect(getKaspaIndexer("testnet")).toBeNull();
  });

  it("uses KASPA_TESTNET_INDEXER_URL when set", () => {
    process.env.KASPA_INDEXER_ENABLED = "true";
    process.env.KASPA_TESTNET_INDEXER_URL = "https://api-tn10.example.com";
    resetKaspaIndexerForTests();
    expect(getKaspaIndexer("testnet")?.providerId).toBe("rest:api-tn10.example.com");
  });

  it("returns null and logs once when configuration is invalid", () => {
    process.env.KASPA_INDEXER_ENABLED = "true";
    process.env.KASPA_MAINNET_INDEXER_URL = "not-a-url";
    resetKaspaIndexerForTests();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(getKaspaIndexer("mainnet")).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);

    // memoized: a second call must not retry
    expect(getKaspaIndexer("mainnet")).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
