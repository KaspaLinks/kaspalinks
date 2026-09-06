import { afterEach, describe, expect, it, vi } from "vitest";

import { isClaimableFundingAddressEmpty, resolveClaimableOnChain } from "./claimable-onchain";

const ADDRESS = "kaspa:pqtvlcvulje439t7dankkw56m2z75zhjqrwkrqf6qnlgrsuwy8ahxgf55x7hg";
const FUNDING_TX_ID = "a".repeat(64);

describe("resolveClaimableOnChain", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    { claimTxId: null, expected: "spent_unknown", refundTxId: null },
    { claimTxId: "b".repeat(64), expected: "claimed", refundTxId: null },
    { claimTxId: null, expected: "refunded", refundTxId: "c".repeat(64) },
  ])("classifies a missing funding UTXO as $expected", async (testCase) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes(`/transactions/${FUNDING_TX_ID}`)) {
          return new Response(
            JSON.stringify({
              block_time: 1,
              is_accepted: true,
              outputs: [
                {
                  amount: "100000000",
                  index: 0,
                  script_public_key_address: ADDRESS,
                },
              ],
              transaction_id: FUNDING_TX_ID,
            }),
            { status: 200 },
          );
        }
        if (url.includes("/utxos")) {
          return new Response("[]", { status: 200 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    await expect(
      resolveClaimableOnChain({
        amountSompi: "100000000",
        claimTxId: testCase.claimTxId,
        createdAtMs: 0,
        fundingAddress: ADDRESS,
        fundingOutputIndex: 0,
        fundingTxId: FUNDING_TX_ID,
        refundLockTime: "999999999999",
        refundTxId: testCase.refundTxId,
        status: "funded",
      }),
    ).resolves.toEqual({ status: testCase.expected });
  });
});

describe("claimable deletion funding proof", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it.each(["1", "50000000", "200000000"])(
    "does not treat a remaining %s-sompi output as empty",
    async (amount) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify([{ utxoEntry: { amount } }]))),
      );
      expect(await isClaimableFundingAddressEmpty(ADDRESS)).toBe(false);
    },
  );
  it("accepts only a successful empty UTXO array", async () => {
    const mock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", mock);
    expect(await isClaimableFundingAddressEmpty(ADDRESS)).toBe(true);
    expect(mock).toHaveBeenCalledWith(
      expect.stringContaining("/utxos"),
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
  });
  it.each([new Response("{}"), new Response("[]", { status: 503 })])(
    "rejects malformed or failed lookups",
    async (response) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(isClaimableFundingAddressEmpty(ADDRESS)).rejects.toThrow();
    },
  );
});
