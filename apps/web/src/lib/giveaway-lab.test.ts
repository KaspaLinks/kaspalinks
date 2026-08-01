import { describe, expect, it } from "vitest";

import {
  computeGiveawayDraw,
  computeGiveawayDrawV2,
  computeGiveawayFreezeCommitment,
  createGiveawayDrawSeed,
  effectiveGiveawayStatus,
  freezeGiveawayEntries,
  normalizeGiveawayAddress,
  parseGiveawayTerms,
  verifyGiveawaySeed,
} from "./giveaway-lab";

const MAINNET_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const SECOND_MAINNET_ADDRESS =
  "kaspa:qpy6l7q6apd79nqw00drvjtr83hrj95ma582r0g24ttlpuh57hmecd09de4en";
const TESTNET_ADDRESS = "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz";

describe("giveaway lab helpers", () => {
  it("commits to a hidden draw seed before entries are accepted", () => {
    const draw = createGiveawayDrawSeed();

    expect(draw.seedHex).toMatch(/^[0-9a-f]{64}$/);
    expect(draw.commitment).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyGiveawaySeed(draw.seedHex, draw.commitment)).toBe(true);
    expect(verifyGiveawaySeed("0".repeat(64), draw.commitment)).toBe(false);
  });

  it("produces the same winner regardless of database entry order", () => {
    const input = {
      closesAt: new Date("2026-07-20T12:00:00.000Z"),
      publicId: "giveaway-test",
      seedHex: "12".repeat(32),
    };
    const entries = [
      { address: MAINNET_ADDRESS, id: "entry-a" },
      { address: SECOND_MAINNET_ADDRESS, id: "entry-b" },
    ];

    const first = computeGiveawayDraw({ ...input, entries });
    const second = computeGiveawayDraw({ ...input, entries: [...entries].reverse() });

    expect(second).toEqual(first);
    expect(first.entryHashes).toHaveLength(2);
    expect(entries.map((entry) => entry.address)).toContain(first.winnerAddress);
  });

  it("freezes the same Merkle root regardless of database entry order", () => {
    const entries = [
      { address: MAINNET_ADDRESS, id: "entry-a" },
      { address: SECOND_MAINNET_ADDRESS, id: "entry-b" },
    ];

    const first = freezeGiveawayEntries(entries);
    const second = freezeGiveawayEntries([...entries].reverse());

    expect(second).toEqual(first);
    expect(first.entriesRoot).toMatch(/^[0-9a-f]{64}$/);
  });

  it("binds a v2 draw to the frozen entries and future chain block", () => {
    const entries = [
      { address: MAINNET_ADDRESS, id: "entry-a" },
      { address: SECOND_MAINNET_ADDRESS, id: "entry-b" },
    ];
    const closesAt = new Date("2026-07-20T12:00:00.000Z");
    const drawSeed = createGiveawayDrawSeed();
    const drawCommitment = drawSeed.commitment;
    const entropyTargetBlueScore = 500_000_100n;
    const frozen = freezeGiveawayEntries(entries);
    const draw = computeGiveawayDrawV2({
      closesAt,
      drawCommitment,
      entries,
      entriesRoot: frozen.entriesRoot,
      entropyBlockBlueScore: 500_000_101n,
      entropyBlockHash: "cd".repeat(32),
      entropyTargetBlueScore,
      publicId: "giveaway-v2",
      seedHex: drawSeed.seedHex,
    });

    expect(draw.entriesRoot).toBe(frozen.entriesRoot);
    expect(draw.freezeCommitment).toBe(
      computeGiveawayFreezeCommitment({
        closesAt,
        drawCommitment,
        entriesRoot: frozen.entriesRoot,
        entryCount: entries.length,
        entropyTargetBlueScore,
        publicId: "giveaway-v2",
      }),
    );
    expect(draw.entryHashes).toEqual(frozen.entryHashes);
    expect(entries.map((entry) => entry.address)).toContain(draw.winnerAddress);

    const changedEntropy = computeGiveawayDrawV2({
      closesAt,
      drawCommitment,
      entries,
      entriesRoot: frozen.entriesRoot,
      entropyBlockBlueScore: 500_000_102n,
      entropyBlockHash: "ef".repeat(32),
      entropyTargetBlueScore,
      publicId: "giveaway-v2",
      seedHex: drawSeed.seedHex,
    });
    expect(changedEntropy.digest).not.toBe(draw.digest);
  });

  it("rejects a v2 draw when the entry list no longer matches the frozen root", () => {
    const entries = [{ address: MAINNET_ADDRESS, id: "entry-a" }];
    const frozen = freezeGiveawayEntries(entries);
    const drawSeed = createGiveawayDrawSeed();

    expect(() =>
      computeGiveawayDrawV2({
        closesAt: new Date("2026-07-20T12:00:00.000Z"),
        drawCommitment: drawSeed.commitment,
        entries: [...entries, { address: SECOND_MAINNET_ADDRESS, id: "entry-b" }],
        entriesRoot: frozen.entriesRoot,
        entropyBlockBlueScore: 500_000_101n,
        entropyBlockHash: "cd".repeat(32),
        entropyTargetBlueScore: 500_000_100n,
        publicId: "giveaway-v2",
        seedHex: drawSeed.seedHex,
      }),
    ).toThrow("frozen participant root");
  });

  it("enforces a reliable payout amount and bounded entry window", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(() =>
      parseGiveawayTerms(
        {
          amountKas: "0.1",
          closesAt: "2026-07-20T12:10:00.000Z",
          title: "Too small",
        },
        now,
      ),
    ).toThrow("at least 0.2 KAS");
    expect(() =>
      parseGiveawayTerms(
        {
          amountKas: "1",
          closesAt: "2026-07-20T12:00:10.000Z",
          title: "Too short",
        },
        now,
      ),
    ).toThrow("at least 30 seconds");

    expect(
      parseGiveawayTerms(
        {
          amountKas: "1",
          closesAt: "2026-07-20T12:15:00.000Z",
          description: "  A test draw.  ",
          title: " Test giveaway ",
        },
        now,
      ),
    ).toMatchObject({
      amountKas: "1",
      amountSompi: 100_000_000n,
      description: "A test draw.",
      entryWindowSeconds: 900,
      title: "Test giveaway",
    });
  });

  it("keeps prize-backed giveaways pending until their entry window opens", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    const closesAt = new Date("2026-07-20T12:15:00.000Z");

    expect(effectiveGiveawayStatus("OPEN", closesAt, now, null)).toBe("PENDING_FUNDING");
    expect(effectiveGiveawayStatus("OPEN", closesAt, now, now)).toBe("OPEN");
  });

  it("accepts mainnet addresses and rejects testnet entries", () => {
    expect(normalizeGiveawayAddress(MAINNET_ADDRESS)).toBe(MAINNET_ADDRESS);
    expect(() => normalizeGiveawayAddress(TESTNET_ADDRESS)).toThrow("mainnet kaspa: address");
  });
});
