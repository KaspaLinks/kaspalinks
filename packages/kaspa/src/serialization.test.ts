import { describe, expect, it } from "vitest";

import { bigIntJsonReplacer, serializeBigInts, stringifyWithBigInts } from "./serialization";

describe("BigInt JSON serialization", () => {
  it("converts BigInt values to strings with a JSON replacer", () => {
    expect(JSON.stringify({ amountSompi: 1_000_000_000n }, bigIntJsonReplacer)).toBe(
      '{"amountSompi":"1000000000"}',
    );
  });

  it("recursively serializes BigInt values for JSON responses", () => {
    expect(
      serializeBigInts({
        amountSompi: 1_000_000_000n,
        nested: [{ feeSompi: 1n }],
      }),
    ).toEqual({
      amountSompi: "1000000000",
      nested: [{ feeSompi: "1" }],
    });
  });

  it("stringifies objects containing BigInt values", () => {
    expect(stringifyWithBigInts({ amountSompi: 42n })).toBe('{"amountSompi":"42"}');
  });
});
