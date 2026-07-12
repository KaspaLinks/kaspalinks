import { describe, expect, it } from "vitest";

import { createRestKaspaIndexer, KaspaIndexerError } from "./index";

const RECIPIENT = "kaspa:qpzry9x8gf2tvdw0s3jn54khce6mua7lqpzry9x8gf2tvdw0s3jn54khce6mua7l";

function buildFetchMock(
  status: number,
  body: unknown,
  capture?: { calls: string[] },
): typeof fetch {
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    capture?.calls.push(url);
    const json = JSON.stringify(body);
    return new Response(json, {
      headers: { "content-type": "application/json" },
      status,
    });
  };
  return impl as typeof fetch;
}

describe("createRestKaspaIndexer", () => {
  it("returns a match when an accepted output to the recipient exists with the expected amount", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [
        {
          block_time: 1_770_000_000_000,
          is_accepted: true,
          outputs: [
            {
              amount: 1_000_000_000,
              index: 0,
              script_public_key_address: RECIPIENT,
            },
          ],
          transaction_id: "abc123",
        },
      ]),
    });

    const result = await indexer.findIncomingPayment({
      amountSompi: 1_000_000_000n,
      recipientAddress: RECIPIENT,
    });

    expect(result).toEqual({
      blockTime: 1_770_000_000_000,
      matchedSompi: 1_000_000_000n,
      outputIndex: 0,
      transactionId: "abc123",
    });
  });

  it("ignores transactions that are not accepted", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [
        {
          block_time: 1_770_000_000_000,
          is_accepted: false,
          outputs: [
            {
              amount: 1_000_000_000,
              index: 0,
              script_public_key_address: RECIPIENT,
            },
          ],
          transaction_id: "abc123",
        },
      ]),
    });

    const result = await indexer.findIncomingPayment({
      amountSompi: 1_000_000_000n,
      recipientAddress: RECIPIENT,
    });

    expect(result).toBeNull();
  });

  it("ignores outputs to a different address", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [
        {
          is_accepted: true,
          outputs: [{ amount: 1_000_000_000, script_public_key_address: "kaspa:other" }],
          transaction_id: "abc123",
        },
      ]),
    });

    const result = await indexer.findIncomingPayment({
      amountSompi: 1_000_000_000n,
      recipientAddress: RECIPIENT,
    });

    expect(result).toBeNull();
  });

  it("ignores outputs with the wrong amount", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [
        {
          is_accepted: true,
          outputs: [
            { amount: 999_999_999, script_public_key_address: RECIPIENT },
            { amount: 1_000_000_000, script_public_key_address: RECIPIENT, index: 1 },
          ],
          transaction_id: "abc123",
        },
      ]),
    });

    const exact = await indexer.findIncomingPayment({
      amountSompi: 1_000_000_000n,
      recipientAddress: RECIPIENT,
    });
    expect(exact?.outputIndex).toBe(1);

    const noMatch = await indexer.findIncomingPayment({
      amountSompi: 2_000_000_000n,
      recipientAddress: RECIPIENT,
    });
    expect(noMatch).toBeNull();
  });

  it("accepts amount values delivered as strings (BigInt-safe)", async () => {
    const huge = 10_000_000_000_000_000n; // 100_000_000 KAS, above MAX_SAFE_INTEGER once × sompi
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [
        {
          is_accepted: true,
          outputs: [{ amount: huge.toString(), script_public_key_address: RECIPIENT }],
          transaction_id: "huge",
        },
      ]),
    });

    const result = await indexer.findIncomingPayment({
      amountSompi: huge,
      recipientAddress: RECIPIENT,
    });

    expect(result?.transactionId).toBe("huge");
  });

  it("passes notBefore as an after= query parameter, with clock-skew margin", async () => {
    const capture = { calls: [] as string[] };
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [], capture),
    });

    const notBefore = 1_770_000_000_000;
    await indexer.findIncomingPayment({
      amountSompi: 1_000_000_000n,
      notBefore,
      recipientAddress: RECIPIENT,
    });

    expect(capture.calls.length).toBe(1);
    const url = new URL(capture.calls[0] as string);
    expect(Number(url.searchParams.get("after"))).toBeLessThan(notBefore);
  });

  it("treats 404 as no match", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(404, { detail: "not found" }),
    });
    const result = await indexer.findIncomingPayment({
      amountSompi: 1_000_000_000n,
      recipientAddress: RECIPIENT,
    });
    expect(result).toBeNull();
  });

  it("throws a typed error on non-2xx responses other than 404", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(500, { detail: "boom" }),
    });
    await expect(
      indexer.findIncomingPayment({
        amountSompi: 1_000_000_000n,
        recipientAddress: RECIPIENT,
      }),
    ).rejects.toBeInstanceOf(KaspaIndexerError);
  });

  it("returns null for non-positive amounts without calling the network", async () => {
    let called = false;
    const indexer = createRestKaspaIndexer({
      fetchImpl: async () => {
        called = true;
        return new Response("[]", { status: 200 });
      },
    });
    const result = await indexer.findIncomingPayment({
      amountSompi: 0n,
      recipientAddress: RECIPIENT,
    });
    expect(result).toBeNull();
    expect(called).toBe(false);
  });

  it("matches any positive-value output when amountSompi is omitted", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [
        {
          is_accepted: true,
          outputs: [{ amount: 0, script_public_key_address: RECIPIENT }],
          transaction_id: "zero",
        },
        {
          block_time: 1_770_000_000_000,
          is_accepted: true,
          outputs: [{ amount: 333, index: 2, script_public_key_address: RECIPIENT }],
          transaction_id: "match",
        },
      ]),
    });

    const result = await indexer.findIncomingPayment({
      recipientAddress: RECIPIENT,
    });

    expect(result).toEqual({
      blockTime: 1_770_000_000_000,
      matchedSompi: 333n,
      outputIndex: 2,
      transactionId: "match",
    });
  });

  it("lists accepted positive outputs to the recipient and returns their total inputs", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(200, [
        {
          block_time: 1_770_000_000_000,
          is_accepted: true,
          outputs: [
            { amount: 0, script_public_key_address: RECIPIENT },
            { amount: "123", index: 1, script_public_key_address: RECIPIENT },
            { amount: "456", index: 2, script_public_key_address: "kaspa:other" },
          ],
          transaction_id: "first",
        },
        {
          block_time: 1_770_000_001_000,
          is_accepted: true,
          outputs: [{ amount: 777, script_public_key_address: RECIPIENT }],
          transaction_id: "second",
        },
        {
          is_accepted: false,
          outputs: [{ amount: 999, script_public_key_address: RECIPIENT }],
          transaction_id: "ignored",
        },
      ]),
    });

    await expect(indexer.listIncomingPayments({ recipientAddress: RECIPIENT })).resolves.toEqual([
      {
        blockTime: 1_770_000_000_000,
        matchedSompi: 123n,
        outputIndex: 1,
        transactionId: "first",
      },
      {
        blockTime: 1_770_000_001_000,
        matchedSompi: 777n,
        outputIndex: 0,
        transactionId: "second",
      },
    ]);
  });

  it("looks up a reported transaction directly by id", async () => {
    const capture = { calls: [] as string[] };
    const transactionId = "a".repeat(64);
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(
        200,
        {
          block_time: 1_770_000_000_000,
          is_accepted: true,
          outputs: [{ amount: 321, index: 3, script_public_key_address: RECIPIENT }],
          transaction_id: transactionId,
        },
        capture,
      ),
    });

    await expect(
      indexer.findTransactionPayment({
        amountSompi: 321n,
        recipientAddress: RECIPIENT,
        transactionId,
      }),
    ).resolves.toEqual({
      blockTime: 1_770_000_000_000,
      matchedSompi: 321n,
      outputIndex: 3,
      transactionId,
    });
    expect(capture.calls).toEqual([`https://api.kaspa.org/transactions/${transactionId}`]);
  });

  it("treats missing reported transactions as no match", async () => {
    const indexer = createRestKaspaIndexer({
      fetchImpl: buildFetchMock(404, { detail: "not found" }),
    });

    await expect(
      indexer.findTransactionPayment({
        amountSompi: 321n,
        recipientAddress: RECIPIENT,
        transactionId: "b".repeat(64),
      }),
    ).resolves.toBeNull();
  });

  it("derives providerId from baseUrl when not given", () => {
    const indexer = createRestKaspaIndexer({
      baseUrl: "https://api.kaspa.org",
      fetchImpl: async () => new Response("[]"),
    });
    expect(indexer.providerId).toBe("rest:api.kaspa.org");
  });
});
