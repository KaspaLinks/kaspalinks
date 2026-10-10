import { describe, expect, it } from "vitest";

import { deriveGiveawayV6GenesisCovenantIdHex } from "./giveaway-v6-covenant-id";

const OUTPOINT = { transactionId: "01".repeat(32), outputIndex: 7 };
const OUTPUTS = [
  { outputIndex: 0, amountSompi: 100_000_000n, scriptPublicKeyHex: "000051" },
  {
    outputIndex: 3,
    amountSompi: 10_000_000n,
    scriptPublicKeyHex: `0000aa20${"22".repeat(32)}87`,
  },
] as const;

describe("deriveGiveawayV6GenesisCovenantIdHex", () => {
  it("matches the KIP-20 covenant-id result from the vendored rusty-kaspa WASM SDK", () => {
    expect(deriveGiveawayV6GenesisCovenantIdHex(OUTPOINT, OUTPUTS)).toBe(
      "59b73688349198c402baa6df3f5fbaa2ab1d8e69f05fe25af189f5a70561cb8a",
    );
  });

  it("rejects ambiguous output order and invalid integer ranges", () => {
    expect(() => deriveGiveawayV6GenesisCovenantIdHex(OUTPOINT, [OUTPUTS[1], OUTPUTS[0]])).toThrow(
      "strictly increasing",
    );
    expect(() =>
      deriveGiveawayV6GenesisCovenantIdHex(OUTPOINT, [{ ...OUTPUTS[0], amountSompi: 1n << 64n }]),
    ).toThrow("uint64");
  });
});
