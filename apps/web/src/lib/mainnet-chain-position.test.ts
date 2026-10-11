import { afterEach, describe, expect, it, vi } from "vitest";

import { readCurrentMainnetChainPosition } from "./mainnet-chain-position";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("current Mainnet chain position", () => {
  it("reads and validates both public counters from the configured indexer", async () => {
    vi.stubEnv("KASPA_MAINNET_INDEXER_URL", "https://indexer.example/");
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      return new Response(
        JSON.stringify(
          value.endsWith("/info/blockdag")
            ? { networkName: "kaspa-mainnet", virtualDaaScore: "536000000" }
            : { blueScore: "535000000" },
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(readCurrentMainnetChainPosition()).resolves.toEqual({
      blueScore: 535_000_000n,
      daa: 536_000_000n,
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://indexer.example/info/blockdag",
      "https://indexer.example/info/virtual-chain-blue-score",
    ]);
  });

  it("fails closed for a response from another network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/info/blockdag")
              ? { networkName: "kaspa-testnet-10", virtualDaaScore: "536000000" }
              : { blueScore: "535000000" },
          ),
          { status: 200 },
        ),
      ),
    );

    await expect(readCurrentMainnetChainPosition()).rejects.toThrow();
  });
});
