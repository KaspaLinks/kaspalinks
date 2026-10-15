import { createRequire } from "node:module";

import { afterAll, describe, expect, it } from "vitest";

import { buildGiveawayV6CreationTerms, createGiveawayV6InputSchema } from "./giveaway-v6-creation";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const returnKey = new sdk.PrivateKey("71".repeat(32));
const returnAddress = returnKey.toPublicKey().toAddress("mainnet").toString();

afterAll(() => returnKey.free());

const slotStartsAt = new Date("2026-10-15T12:00:00.000Z");
const slot = {
  closesAtDaa: 536_036_000n,
  entropyTargetBlueScore: 535_036_600n,
  returnAtDaa: 536_900_000n,
};

describe("Giveaway V6 creator terms", () => {
  it("derives the reviewed four-shard budget and commits the slot's chain deadlines", () => {
    const terms = buildGiveawayV6CreationTerms({
      slot,
      giveawayIdHex: "42".repeat(32),
      request: {
        amountKas: "1",
        description: "  Mainnet draw  ",
        participantCap: 32,
        returnAddress,
        slotStartsAt,
        title: "  Community KAS  ",
      },
    });

    expect(terms).toMatchObject({
      amountKas: "1",
      description: "Mainnet draw",
      executionReserveSompi: 404_000_000n,
      expectedFundingSompi: 514_000_000n,
      maximumEntryFeesSompi: 320_000_000n,
      maximumNetworkCostSompi: 381_000_000n,
      minimumReturnSompi: 33_000_000n,
      participantCap: 32,
      title: "Community KAS",
    });
    expect(terms.config).toMatchObject({
      closesAtDaa: 536_036_000n,
      entropyTargetBlueScore: 535_036_600n,
      giveawayIdHex: "42".repeat(32),
      maxEntriesPerShard: 8,
      returnAtDaa: 536_900_000n,
      shardCount: 4,
      treeDepth: 10,
    });
    expect(terms.config.returnScriptPublicKeyHex).toMatch(/^[0-9a-f]+$/u);
    expect(terms.economics).toMatchObject({
      activationFeeSompi: 10_000_000n,
      drawFeeSompi: 18_000_000n,
      entryFeeSompi: 10_000_000n,
      freezeFeeSompi: 33_000_000n,
      prizeValueSompi: 100_000_000n,
      shardValueSompi: 101_000_000n,
      returnFeeSompi: 3_000_000n,
    });
  });

  it.each([
    {
      cap: 8 as const,
      expectedFundingSompi: 224_000_000n,
      shardCount: 1,
      shardValueSompi: 164_000_000n,
    },
    {
      cap: 16 as const,
      expectedFundingSompi: 304_000_000n,
      shardCount: 2,
      shardValueSompi: 122_000_000n,
    },
    {
      cap: 32 as const,
      expectedFundingSompi: 464_000_000n,
      shardCount: 4,
      shardValueSompi: 101_000_000n,
    },
  ])(
    "sizes the execution reserve for a $cap-person 0.5 KAS giveaway",
    ({ cap, expectedFundingSompi, shardCount, shardValueSompi }) => {
      const terms = buildGiveawayV6CreationTerms({
        slot,
        giveawayIdHex: "24".repeat(32),
        request: {
          amountKas: "0.5",
          participantCap: cap,
          returnAddress,
          slotStartsAt,
          title: "Sized draw",
        },
      });

      expect(terms.expectedFundingSompi).toBe(expectedFundingSompi);
      expect(terms.config.shardCount).toBe(shardCount);
      expect(terms.economics.shardValueSompi).toBe(shardValueSompi);
      expect(terms.minimumReturnSompi).toBe(33_000_000n);
    },
  );

  it("accepts only the reviewed prize choices and rejects extra recovery material", () => {
    const base = {
      amountKas: "1",
      participantCap: 8,
      returnAddress,
      slotStartsAt: "2026-10-15T12:00:00.000Z",
      title: "Community KAS",
    };
    expect(createGiveawayV6InputSchema.safeParse(base).success).toBe(true);
    expect(createGiveawayV6InputSchema.safeParse({ ...base, slotStartsAt: "noon" }).success).toBe(
      false,
    );
    // A free duration is no longer a term a creator can choose.
    expect(createGiveawayV6InputSchema.safeParse({ ...base, durationSeconds: 3_600 }).success).toBe(
      false,
    );
    expect(createGiveawayV6InputSchema.safeParse({ ...base, amountKas: "2" }).success).toBe(false);
    expect(createGiveawayV6InputSchema.safeParse({ ...base, participantCap: 12 }).success).toBe(
      false,
    );
    expect(
      createGiveawayV6InputSchema.safeParse({ ...base, recoveryFile: "do-not-accept" }).success,
    ).toBe(false);
  });
});
