import { describe, expect, it } from "vitest";

import {
  parseGiveawayV6FamilyJson,
  serializeGiveawayV6FamilyJson,
} from "./giveaway-v6-family-json";

const FAMILY_JSON = {
  genesisOutpoint: { transactionId: "01".repeat(32), outputIndex: 2 },
  covenantIdHex: "02".repeat(32),
  prizeTemplateHashHex: "03".repeat(32),
  shardTemplateHashHex: "04".repeat(32),
  prizeValueSompi: "100000000",
  shardValueSompi: "10000",
  entryFeeSompi: "1000",
  activationFeeSompi: "2000",
  freezeFeeSompi: "3000",
  drawFeeSompi: "4000",
  returnFeeSompi: "5000",
};

describe("Giveaway V6 family JSON boundary", () => {
  it("round-trips public family values with decimal uint64 strings", () => {
    const parsed = parseGiveawayV6FamilyJson(FAMILY_JSON);

    expect(parsed.prizeValueSompi).toBe(100_000_000n);
    expect(serializeGiveawayV6FamilyJson(parsed)).toEqual(FAMILY_JSON);
  });

  it("rejects unknown, zero, imprecise, and secret-looking fields", () => {
    expect(() => parseGiveawayV6FamilyJson({ ...FAMILY_JSON, privateKey: "never" })).toThrow(
      /malformed/u,
    );
    expect(() => parseGiveawayV6FamilyJson({ ...FAMILY_JSON, drawFeeSompi: "0" })).toThrow(
      /malformed/u,
    );
    expect(() => parseGiveawayV6FamilyJson({ ...FAMILY_JSON, drawFeeSompi: 4000 })).toThrow(
      /malformed/u,
    );
  });
});
