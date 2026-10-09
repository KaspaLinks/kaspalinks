import { describe, expect, it } from "vitest";

import {
  parseGiveawayV6ChainEventsJson,
  parseGiveawayV6ConfigJson,
  reconstructGiveawayV6FromJson,
} from "./giveaway-v6-chain-json";

const configJson = {
  giveawayIdHex: "42".repeat(32),
  closesAtDaa: "100",
  returnAtDaa: "200",
  entropyTargetBlueScore: "300",
  shardCount: 1,
  treeDepth: 4,
  maxEntriesPerShard: 16,
  returnScriptPublicKeyHex: "000051",
};

const activationJson = {
  kind: "activate",
  transactionId: "AA".repeat(32),
  blockDaaScore: "90",
  prizeOutputIndex: 0,
  shardOutputIndexes: [1],
};

describe("Giveaway V6 JSON boundary", () => {
  it("converts decimal u64 strings without losing precision and normalizes hex", () => {
    const config = parseGiveawayV6ConfigJson({
      ...configJson,
      entropyTargetBlueScore: "18446744073709551615",
    });
    const events = parseGiveawayV6ChainEventsJson([activationJson]);

    expect(config.entropyTargetBlueScore).toBe(18_446_744_073_709_551_615n);
    expect(events[0]?.transactionId).toBe("aa".repeat(32));
    expect(events[0]?.blockDaaScore).toBe(90n);
    expect(reconstructGiveawayV6FromJson(configJson, [activationJson])).toMatchObject({
      phase: "open",
      activationTransactionId: "aa".repeat(32),
    });
  });

  it.each([
    { ...configJson, closesAtDaa: 100 },
    { ...configJson, closesAtDaa: "1e2" },
    { ...configJson, closesAtDaa: "18446744073709551616" },
    { ...configJson, returnScriptPublicKeyHex: "51" },
    { ...configJson, internalSecret: "must-not-cross-the-boundary" },
  ])("rejects malformed or unexpected configuration fields", (input) => {
    expect(() => parseGiveawayV6ConfigJson(input)).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIG" }),
    );
  });

  it("rejects unknown transition fields and numeric DAA scores", () => {
    expect(() =>
      parseGiveawayV6ChainEventsJson([{ ...activationJson, blockDaaScore: 90 }]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }));
    expect(() =>
      parseGiveawayV6ChainEventsJson([{ ...activationJson, privateKey: "never" }]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }));
  });
});
