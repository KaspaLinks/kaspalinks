import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readResilientMainnetDagInfo, resetMainnetDagInfoCacheForTests } from "./mainnet-dag-info";

const NOW = Date.parse("2026-10-23T19:20:00.000Z");

function dagInfo(medianLagMs: number) {
  return new Response(
    JSON.stringify({
      networkName: "kaspa-mainnet",
      pastMedianTime: String(NOW - medianLagMs),
      virtualDaaScore: "573628439",
    }),
    { status: 200 },
  );
}

describe("readResilientMainnetDagInfo", () => {
  beforeEach(() => {
    resetMainnetDagInfoCacheForTests();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads a live score and never from the Next.js data cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(dagInfo(2 * 60_000));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readResilientMainnetDagInfo()).resolves.toMatchObject({
      virtualDaaScore: "573628439",
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { next?: unknown };
    expect(init.cache).toBe("no-store");
    expect(init.next).toBeUndefined();
  });

  it("refuses a score whose median time is hours old", async () => {
    // A cached 23.5 hour old score once turned a 24 hour claim window into 30 minutes.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dagInfo(23.5 * 60 * 60_000)));

    await expect(readResilientMainnetDagInfo()).rejects.toThrow(/unavailable/u);
  });
});
