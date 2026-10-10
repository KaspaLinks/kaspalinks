import { describe, expect, it, vi } from "vitest";

import { createKaspaVspcRelayClient } from "./kaspa-vspc-relay-client";

const START_HASH = "01".repeat(32);

describe("createKaspaVspcRelayClient", () => {
  it("uses only the private relay read endpoints and preserves decimal strings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ network: "mainnet" }))
      .mockResolvedValueOnce(
        jsonResponse({
          removedChainBlockHashes: [],
          addedChainBlockHashes: [],
          chainBlockAcceptedTransactions: [],
          virtualDaaScore: "500000000",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ blocks: [] }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = createKaspaVspcRelayClient({
      relayUrl: "http://toccata-relay:3010",
      fetchImpl,
    });

    await expect(client.getCurrentNetwork(null)).resolves.toEqual({ network: "mainnet" });
    await expect(
      client.getVirtualChainFromBlockV2({
        startHash: START_HASH,
        dataVerbosityLevel: "Full",
        minConfirmationCount: 10,
      }),
    ).resolves.toMatchObject({ virtualDaaScore: "500000000" });
    await expect(client.getBlockHeaders([START_HASH])).resolves.toEqual({ blocks: [] });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      new URL("http://toccata-relay:3010/network"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL("http://toccata-relay:3010/virtual-chain-v2"),
      expect.objectContaining({
        body: JSON.stringify({
          startHash: START_HASH,
          dataVerbosityLevel: "Full",
          minConfirmationCount: 10,
        }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      new URL("http://toccata-relay:3010/block-headers"),
      expect.objectContaining({
        body: JSON.stringify({ hashes: [START_HASH] }),
        method: "POST",
      }),
    );
  });

  it("hides relay error details and rejects invalid configuration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "INVALID_RELAY_REQUEST", message: "private upstream detail" } },
          400,
        ),
      );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = createKaspaVspcRelayClient({
      relayUrl: "http://toccata-relay:3010/",
      fetchImpl,
    });

    await expect(client.getCurrentNetwork(null)).rejects.toMatchObject({
      code: "VSPC_RPC_ERROR",
      message: "Internal Kaspa relay rejected the request with status 400.",
    });
    expect(() => createKaspaVspcRelayClient({ relayUrl: "file:///tmp/socket" })).toThrowError(
      expect.objectContaining({ code: "VSPC_CONFIG_ERROR" }),
    );
  });

  it("rejects oversized responses before parsing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        headers: { "content-length": String(64 * 1024 * 1024 + 1) },
      }),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = createKaspaVspcRelayClient({
      relayUrl: "http://toccata-relay:3010",
      fetchImpl,
    });

    await expect(client.getCurrentNetwork(null)).rejects.toMatchObject({
      code: "VSPC_PARSE_ERROR",
    });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
