import { describe, expect, it } from "vitest";

import {
  computeGiveawayDrawV2,
  createGiveawayDrawSeed,
  freezeGiveawayEntries,
} from "./giveaway-lab";
import { verifyGiveawayDrawInBrowser } from "./giveaway-proof-browser";

const ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const SECOND_ADDRESS = "kaspa:qpy6l7q6apd79nqw00drvjtr83hrj95ma582r0g24ttlpuh57hmecd09de4en";

describe("browser giveaway proof verifier", () => {
  it("recomputes a v2 draw without trusting the server result", async () => {
    const entries = [
      { address: ADDRESS, id: "entry-a" },
      { address: SECOND_ADDRESS, id: "entry-b" },
    ];
    const seed = createGiveawayDrawSeed();
    const frozen = freezeGiveawayEntries(entries);
    const draw = computeGiveawayDrawV2({
      closesAt: new Date("2026-08-01T12:00:00.000Z"),
      drawCommitment: seed.commitment,
      entries,
      entriesRoot: frozen.entriesRoot,
      entropyBlockBlueScore: 500_000_101n,
      entropyBlockHash: "cd".repeat(32),
      entropyTargetBlueScore: 500_000_100n,
      publicId: "giveaway-browser-v2",
      seedHex: seed.seedHex,
    });

    await expect(
      verifyGiveawayDrawInBrowser({
        closesAt: "2026-08-01T12:00:00.000Z",
        digest: draw.digest,
        drawCommitment: seed.commitment,
        entriesRoot: draw.entriesRoot,
        entryHashes: draw.entryHashes,
        entropyBlockBlueScore: "500000101",
        entropyBlockHash: "cd".repeat(32),
        entropyTargetBlueScore: "500000100",
        freezeCommitment: draw.freezeCommitment,
        publicId: "giveaway-browser-v2",
        seed: seed.seedHex,
        winnerAddress: draw.winnerAddress,
        winnerIndex: draw.winnerIndex,
      }),
    ).resolves.toMatchObject({ valid: true });
  });

  it("fails when the published winner address is changed", async () => {
    const entries = [
      { address: ADDRESS, id: "entry-a" },
      { address: SECOND_ADDRESS, id: "entry-b" },
    ];
    const seed = createGiveawayDrawSeed();
    const frozen = freezeGiveawayEntries(entries);
    const draw = computeGiveawayDrawV2({
      closesAt: new Date("2026-08-01T12:00:00.000Z"),
      drawCommitment: seed.commitment,
      entries,
      entriesRoot: frozen.entriesRoot,
      entropyBlockBlueScore: 500_000_101n,
      entropyBlockHash: "cd".repeat(32),
      entropyTargetBlueScore: 500_000_100n,
      publicId: "giveaway-browser-v2",
      seedHex: seed.seedHex,
    });

    const wrongAddress = draw.winnerAddress === ADDRESS ? SECOND_ADDRESS : ADDRESS;
    await expect(
      verifyGiveawayDrawInBrowser({
        closesAt: "2026-08-01T12:00:00.000Z",
        digest: draw.digest,
        drawCommitment: seed.commitment,
        entriesRoot: draw.entriesRoot,
        entryHashes: draw.entryHashes,
        entropyBlockBlueScore: "500000101",
        entropyBlockHash: "cd".repeat(32),
        entropyTargetBlueScore: "500000100",
        freezeCommitment: draw.freezeCommitment,
        publicId: "giveaway-browser-v2",
        seed: seed.seedHex,
        winnerAddress: wrongAddress,
        winnerIndex: draw.winnerIndex,
      }),
    ).resolves.toMatchObject({ valid: false, winnerMatches: false });
  });
});
