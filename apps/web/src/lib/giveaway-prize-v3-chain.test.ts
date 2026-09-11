import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readPrototypePayout,
  verifyPrototypeEntropy,
  readPrototypeUtxos,
} from "./giveaway-prize-v3-chain";
const hash = "ab".repeat(32),
  seed = "cd".repeat(32);
function mockChain(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      Response.json(
        url.includes("/blocks/")
          ? {
              header: {
                version: 2,
                daaScore: "536000000",
                blueScore: "535000000",
                acceptedIdMerkleRoot: seed,
              },
              verboseData: { hash, isChainBlock: true, ...overrides },
            }
          : url.includes("blockdag")
            ? { networkName: "kaspa-mainnet", virtualDaaScore: "536000200" }
            : { blueScore: "535000200" },
      ),
    ),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("prototype chain entropy", () => {
  it("uses the sequencing commitment, not the block hash", async () => {
    mockChain();
    expect(
      (
        await verifyPrototypeEntropy(
          { blockHash: hash, blockBlueScore: "535000000", seedHex: "" },
          false,
        )
      ).seedHex,
    ).toBe(seed);
  });
  it("refuses to replace a persisted commitment", async () => {
    mockChain();
    await expect(
      verifyPrototypeEntropy({
        blockHash: hash,
        blockBlueScore: "535000000",
        seedHex: "00".repeat(32),
      }),
    ).rejects.toThrow(/changed/);
  });
  it("refuses a block removed from the selected chain", async () => {
    mockChain({ isChainBlock: false });
    await expect(
      verifyPrototypeEntropy({ blockHash: hash, blockBlueScore: "535000000", seedHex: seed }),
    ).rejects.toThrow();
  });
  it("does not treat malformed UTXO data as an empty address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "upstream" })),
    );
    await expect(readPrototypeUtxos("kaspa:test")).rejects.toThrow();
  });
});

describe("confirmed prototype payout", () => {
  const manifest = { prizeSompi: "100000000", entries: [{ address: "kaspa:winner" }] };
  it("requires accepted identity, exact prize and a participant destination", async () => {
    const valid = {
      transaction_id: hash,
      is_accepted: true,
      outputs: [{ amount: "100000000", script_public_key_address: "kaspa:winner" }],
    };
    for (const [tx, confirmed] of [
      [valid, true],
      [{ ...valid, is_accepted: false }, false],
      [{ ...valid, transaction_id: seed }, false],
      [{ ...valid, outputs: [{ amount: "1", script_public_key_address: "kaspa:winner" }] }, false],
      [
        { ...valid, outputs: [{ amount: "100000000", script_public_key_address: "kaspa:other" }] },
        false,
      ],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(tx)),
      );
      expect((await readPrototypePayout(hash, manifest)).confirmed).toBe(confirmed);
    }
  });
  it("does not label unavailable transaction data as confirmed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    expect((await readPrototypePayout(hash, manifest)).confirmed).toBe(false);
  });
});
