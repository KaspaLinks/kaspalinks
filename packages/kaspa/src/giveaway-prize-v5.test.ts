import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  GIVEAWAY_PRIZE_V5_DISPATCH_TAGS,
  buildGiveawayPrizeV5Address,
  buildGiveawayPrizeV5RedeemScriptHex,
} from "./giveaway-prize-v5";

/**
 * sha256 of the bytecode silverc produces for giveaway_prize_v5.sil when the
 * platform key constructor argument is 32 bytes of 0x5e and the state is 32
 * bytes of 0x33. Splicing that key into the committed template must reproduce
 * the compiler's output exactly; if it does not, the template is stale or the
 * key no longer sits where the offsets say.
 */
const COMPILED_WITH_5E_SHA256 = "9ef49b5a8306e0ff874ea4681973ac54105fbcf38eef3e3dd24b8f724a269b15";

function sha256Hex(hex: string): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

describe("giveaway prize v5 artifact", () => {
  it("reproduces what the compiler emits for a different platform key", () => {
    const script = buildGiveawayPrizeV5RedeemScriptHex({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(sha256Hex(script)).toBe(COMPILED_WITH_5E_SHA256);
  });

  it("places the platform key in both branches that verify an attestation", () => {
    const script = buildGiveawayPrizeV5RedeemScriptHex({
      platformPublicKeyHex: "ab".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(script.split("ab".repeat(32)).length - 1).toBe(2);
  });

  it("gives every giveaway its own script through the state", () => {
    const platformPublicKeyHex = "5e".repeat(32);
    const a = buildGiveawayPrizeV5RedeemScriptHex({
      platformPublicKeyHex,
      stateHashHex: "01".repeat(32),
    });
    const b = buildGiveawayPrizeV5RedeemScriptHex({
      platformPublicKeyHex,
      stateHashHex: "02".repeat(32),
    });
    expect(a).not.toBe(b);
    expect(a).toHaveLength(b.length);
  });

  it("keeps the script length fixed at 800 bytes", () => {
    const script = buildGiveawayPrizeV5RedeemScriptHex({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(script).toHaveLength(800 * 2);
  });

  it("refuses malformed inputs rather than producing a wrong address", () => {
    expect(() =>
      buildGiveawayPrizeV5RedeemScriptHex({
        platformPublicKeyHex: "5e",
        stateHashHex: "33".repeat(32),
      }),
    ).toThrow(/Platform public key/);
    expect(() =>
      buildGiveawayPrizeV5RedeemScriptHex({
        platformPublicKeyHex: "5e".repeat(32),
        stateHashHex: "zz".repeat(32),
      }),
    ).toThrow(/State hash/);
  });

  it("exposes one dispatch tag per branch", () => {
    const tags = Object.values(GIVEAWAY_PRIZE_V5_DISPATCH_TAGS);
    expect(tags).toHaveLength(3);
    expect(new Set(tags).size).toBe(3);
    for (const tag of tags) expect(tag).toMatch(/^[0-9a-f]{8}$/);
  });

  it("derives a mainnet address from the covenant state", () => {
    const derived = buildGiveawayPrizeV5Address({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(derived.address).toMatch(/^kaspa:[a-z0-9]{60,}$/);
    expect(derived.redeemScriptHex).toHaveLength(800 * 2);
  });

  it("returns the pay-to-script-hash output that address stands for", () => {
    const { scriptPublicKeyHex } = buildGiveawayPrizeV5Address({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    // Two version bytes, OpBlake2b, a 32-byte push, the hash, OpEqual.
    expect(scriptPublicKeyHex).toMatch(/^0000aa20[0-9a-f]{64}87$/);
  });

  it("moves the prize to a new address when the phase changes", () => {
    const platformPublicKeyHex = "5e".repeat(32);
    const open = buildGiveawayPrizeV5Address({
      platformPublicKeyHex,
      stateHashHex: "01".repeat(32),
    });
    const frozen = buildGiveawayPrizeV5Address({
      platformPublicKeyHex,
      stateHashHex: "02".repeat(32),
    });
    expect(open.address).not.toBe(frozen.address);
  });

  it("derives the same address twice for the same giveaway", () => {
    const args = { platformPublicKeyHex: "5e".repeat(32), stateHashHex: "44".repeat(32) };
    expect(buildGiveawayPrizeV5Address(args).address).toBe(
      buildGiveawayPrizeV5Address(args).address,
    );
  });

  it("gives a different platform key a different address for the same state", () => {
    const stateHashHex = "33".repeat(32);
    const a = buildGiveawayPrizeV5Address({ platformPublicKeyHex: "5e".repeat(32), stateHashHex });
    const b = buildGiveawayPrizeV5Address({ platformPublicKeyHex: "ab".repeat(32), stateHashHex });
    expect(a.address).not.toBe(b.address);
  });
});
