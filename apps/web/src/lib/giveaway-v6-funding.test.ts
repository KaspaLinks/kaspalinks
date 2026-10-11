import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GiveawayV6FundingLookupError,
  readGiveawayV6ConfirmedFunding,
} from "./giveaway-v6-funding";

const ADDRESS = "kaspa:pr4khhd3dw35mpw6x8ussg63g62mu5hj9dnv9h6ujkm32v7uelzwkncj2d3uk";
const SERIALIZED_SCRIPT = `0000aa20${"11".repeat(32)}87`;
const RAW_SCRIPT = SERIALIZED_SCRIPT.slice(4);
const TX_ID = "22".repeat(32);
const BLOCK_HASH = "33".repeat(32);
const AMOUNT = 514_000_000n;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Giveaway V6 confirmed funding lookup", () => {
  it("returns no match without reading a transaction", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readFunding()).resolves.toEqual({ status: "not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns one exact accepted ordinary output", async () => {
    vi.stubEnv("KASPA_MAINNET_INDEXER_URL", "https://indexer.example/");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([utxo()]))
      .mockResolvedValueOnce(Response.json(transaction()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readFunding()).resolves.toEqual({
      status: "confirmed",
      funding: {
        acceptingBlockHash: BLOCK_HASH,
        amountSompi: AMOUNT,
        blockDaaScore: 536_000_000n,
        covenantIdHex: null,
        outputIndex: 1,
        scriptPublicKeyHex: SERIALIZED_SCRIPT,
        transactionId: TX_ID,
      },
    });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://indexer.example/addresses/${encodeURIComponent(ADDRESS)}/utxos`,
      `https://indexer.example/transactions/${TX_ID}`,
    ]);
  });

  it("keeps an indexed UTXO pending until transaction acceptance metadata is complete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([utxo()]))
      .mockResolvedValueOnce(
        Response.json(transaction({ accepting_block_hash: null, is_accepted: false })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readFunding()).resolves.toEqual({ status: "pending" });
  });

  it("rejects a transaction output carrying a covenant binding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([utxo()]))
      .mockResolvedValueOnce(
        Response.json(
          transaction({
            outputs: [output({ covenant_authorizing_input: 0, covenant_id: "44".repeat(32) })],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readFunding()).rejects.toEqual(
      expect.objectContaining<Partial<GiveawayV6FundingLookupError>>({
        code: "INVALID_CHAIN_DATA",
      }),
    );
  });

  it("rejects ambiguous exact unspent outputs instead of selecting one", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([utxo(), utxo({ outpoint: { index: 2, transactionId: "55".repeat(32) } })]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readFunding()).rejects.toEqual(
      expect.objectContaining<Partial<GiveawayV6FundingLookupError>>({
        code: "AMBIGUOUS_FUNDING",
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the transaction disagrees with the UTXO", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([utxo()]))
      .mockResolvedValueOnce(
        Response.json(transaction({ outputs: [output({ amount: "514000001" })] })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readFunding()).rejects.toEqual(
      expect.objectContaining<Partial<GiveawayV6FundingLookupError>>({
        code: "INVALID_CHAIN_DATA",
      }),
    );
  });
});

function readFunding() {
  return readGiveawayV6ConfirmedFunding({
    expectedFundingSompi: AMOUNT,
    fundingAddress: ADDRESS,
    fundingScriptPublicKeyHex: SERIALIZED_SCRIPT,
  });
}

function utxo(overrides: Record<string, unknown> = {}) {
  return {
    address: ADDRESS,
    outpoint: { index: 1, transactionId: TX_ID },
    utxoEntry: {
      amount: AMOUNT.toString(),
      blockDaaScore: "536000000",
      isCoinbase: false,
      scriptPublicKey: { scriptPublicKey: RAW_SCRIPT },
    },
    ...overrides,
  };
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    amount: AMOUNT.toString(),
    covenant_authorizing_input: null,
    covenant_id: null,
    index: 1,
    script_public_key: RAW_SCRIPT,
    ...overrides,
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    accepting_block_hash: BLOCK_HASH,
    is_accepted: true,
    outputs: [output()],
    transaction_id: TX_ID,
    ...overrides,
  };
}
