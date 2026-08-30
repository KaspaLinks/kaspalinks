import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GIVEAWAY_ENTROPY_CONFIRMATION_BLUE_SCORE_OFFSET,
  readConfirmedGiveawayChainEntropy,
} from "./giveaway-chain-entropy";

describe("giveaway chain entropy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("waits until the future chain score has enough confirmations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ blueScore: 1_150 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    );

    await expect(readConfirmedGiveawayChainEntropy(1_100n)).resolves.toEqual({
      currentBlueScore: 1_150n,
      ready: false,
      requiredBlueScore: 1_100n + GIVEAWAY_ENTROPY_CONFIRMATION_BLUE_SCORE_OFFSET,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("selects the first confirmed virtual-chain block at or after the target", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ blueScore: 1_250 }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                header: { blueScore: "1100" },
                verboseData: { hash: "a".repeat(64), isChainBlock: false },
              },
              {
                header: { blueScore: "1100" },
                verboseData: { hash: "b".repeat(64), isChainBlock: true },
              },
            ]),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          ),
        ),
    );

    await expect(readConfirmedGiveawayChainEntropy(1_100n)).resolves.toEqual({
      blockBlueScore: 1_100n,
      blockHash: "b".repeat(64),
      currentBlueScore: 1_250n,
      ready: true,
    });
  });

  it("continues after a blue score that contains only non-chain blocks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ blueScore: 1_250 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              header: { blueScore: "1102" },
              verboseData: { hash: "a".repeat(64), isChainBlock: false },
            },
          ]),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              header: { blueScore: "1104" },
              verboseData: { hash: "b".repeat(64), isChainBlock: true },
            },
          ]),
          { headers: { "Content-Type": "application/json" }, status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readConfirmedGiveawayChainEntropy(1_100n)).resolves.toEqual({
      blockBlueScore: 1_104n,
      blockHash: "b".repeat(64),
      currentBlueScore: 1_250n,
      ready: true,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("blueScoreGte=1103"),
      expect.any(Object),
    );
  });
});
