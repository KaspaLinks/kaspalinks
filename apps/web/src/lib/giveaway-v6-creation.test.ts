import { createRequire } from "node:module";

import { afterAll, describe, expect, it } from "vitest";

import {
  GIVEAWAY_V6_PARTICIPANT_CAP,
  buildGiveawayV6CreationTerms,
  createGiveawayV6InputSchema,
} from "./giveaway-v6-creation";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const returnKey = new sdk.PrivateKey("71".repeat(32));
const returnAddress = returnKey.toPublicKey().toAddress("mainnet").toString();

afterAll(() => returnKey.free());

describe("Giveaway V6 creator terms", () => {
  it("derives the reviewed four-shard budget and absolute chain deadlines", () => {
    const terms = buildGiveawayV6CreationTerms({
      chain: { daa: 536_000_000n, blueScore: 535_000_000n },
      giveawayIdHex: "42".repeat(32),
      request: {
        amountKas: "1",
        description: "  Mainnet draw  ",
        durationSeconds: 3_600,
        returnAddress,
        title: "  Community KAS  ",
      },
    });

    expect(terms).toMatchObject({
      amountKas: "1",
      description: "Mainnet draw",
      executionReserveSompi: 404_000_000n,
      expectedFundingSompi: 514_000_000n,
      participantCap: GIVEAWAY_V6_PARTICIPANT_CAP,
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
      returnFeeSompi: 2_000_000n,
    });
  });

  it("accepts only the reviewed prize choices and rejects extra recovery material", () => {
    const base = {
      amountKas: "1",
      durationSeconds: 3_600,
      returnAddress,
      title: "Community KAS",
    };
    expect(createGiveawayV6InputSchema.safeParse(base).success).toBe(true);
    expect(createGiveawayV6InputSchema.safeParse({ ...base, amountKas: "2" }).success).toBe(false);
    expect(
      createGiveawayV6InputSchema.safeParse({ ...base, recoveryFile: "do-not-accept" }).success,
    ).toBe(false);
  });
});
