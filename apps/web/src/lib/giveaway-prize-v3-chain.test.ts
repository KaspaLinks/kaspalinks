import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyPrototypeEntropy, readPrototypeUtxos } from "./giveaway-prize-v3-chain";
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
