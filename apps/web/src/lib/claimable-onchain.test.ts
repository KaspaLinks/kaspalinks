import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveClaimableOnChain } from "./claimable-onchain";

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
