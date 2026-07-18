import { afterEach, describe, expect, it, vi } from "vitest";

import { readCurrentMainnetDaaScore } from "./kaspa-daa";

describe("readCurrentMainnetDaaScore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a validated mainnet DAA score", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ networkName: "kaspa-mainnet", virtualDaaScore: "500000000" }),
            { status: 200 },
          ),
        ),
    );

    await expect(readCurrentMainnetDaaScore()).resolves.toBe(500_000_000n);
  });

  it("rejects responses for a different network", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ networkName: "kaspa-testnet-10", virtualDaaScore: "500000000" }),
            { status: 200 },
          ),
        ),
    );

    await expect(readCurrentMainnetDaaScore()).rejects.toThrow(
      "Unexpected Kaspa BlockDAG response.",
    );
  });

  it("rejects malformed and unsuccessful responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ networkName: "kaspa-mainnet", virtualDaaScore: "not-a-number" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readCurrentMainnetDaaScore()).rejects.toThrow(
      "Unexpected Kaspa BlockDAG response.",
    );
    await expect(readCurrentMainnetDaaScore()).rejects.toThrow(
      "Could not read current Kaspa DAA score.",
    );
  });
});
