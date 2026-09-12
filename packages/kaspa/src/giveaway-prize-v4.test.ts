import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  GIVEAWAY_PRIZE_V4_DISPATCH_TAGS,
  buildGiveawayPrizeV4Address,
  buildGiveawayPrizeV4RedeemScriptHex,
} from "./giveaway-prize-v4";

/**
 * sha256 of the bytecode silverc produces for giveaway_prize_v4.sil when the
 * platform key constructor argument is 32 bytes of 0x5e and the state is 32
 * bytes of 0x33. Splicing that key into the committed template must reproduce
 * the compiler's output exactly; if it does not, the template is stale or the
 * key no longer sits where the offsets say.
 */
const COMPILED_WITH_5E_SHA256 = "03684d49d86c5008f301332bac3f47b9054434104e02791b9396db0f6e472f11";

function sha256Hex(hex: string): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}

describe("giveaway prize v4 artifact", () => {
  it("reproduces what the compiler emits for a different platform key", () => {
    const script = buildGiveawayPrizeV4RedeemScriptHex({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(sha256Hex(script)).toBe(COMPILED_WITH_5E_SHA256);
  });

  it("places the platform key in both branches that verify an attestation", () => {
    const script = buildGiveawayPrizeV4RedeemScriptHex({
      platformPublicKeyHex: "ab".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(script.split("ab".repeat(32)).length - 1).toBe(2);
  });

  it("gives every giveaway its own script through the state", () => {
    const platformPublicKeyHex = "5e".repeat(32);
    const a = buildGiveawayPrizeV4RedeemScriptHex({
      platformPublicKeyHex,
      stateHashHex: "01".repeat(32),
    });
    const b = buildGiveawayPrizeV4RedeemScriptHex({
      platformPublicKeyHex,
      stateHashHex: "02".repeat(32),
    });
    expect(a).not.toBe(b);
    expect(a).toHaveLength(b.length);
  });

  it("keeps the script length fixed at 763 bytes", () => {
    const script = buildGiveawayPrizeV4RedeemScriptHex({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(script).toHaveLength(763 * 2);
  });

  it("refuses malformed inputs rather than producing a wrong address", () => {
    expect(() =>
      buildGiveawayPrizeV4RedeemScriptHex({
        platformPublicKeyHex: "5e",
        stateHashHex: "33".repeat(32),
      }),
    ).toThrow(/Platform public key/);
    expect(() =>
      buildGiveawayPrizeV4RedeemScriptHex({
        platformPublicKeyHex: "5e".repeat(32),
        stateHashHex: "zz".repeat(32),
      }),
    ).toThrow(/State hash/);
  });

  it("exposes one dispatch tag per branch", () => {
    const tags = Object.values(GIVEAWAY_PRIZE_V4_DISPATCH_TAGS);
    expect(tags).toHaveLength(3);
    expect(new Set(tags).size).toBe(3);
    for (const tag of tags) expect(tag).toMatch(/^[0-9a-f]{8}$/);
  });

  it("derives a mainnet address from the covenant state", () => {
    const derived = buildGiveawayPrizeV4Address({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    expect(derived.address).toMatch(/^kaspa:[a-z0-9]{60,}$/);
    expect(derived.redeemScriptHex).toHaveLength(763 * 2);
  });

  it("returns the pay-to-script-hash output that address stands for", () => {
    const { scriptPublicKeyHex } = buildGiveawayPrizeV4Address({
      platformPublicKeyHex: "5e".repeat(32),
      stateHashHex: "33".repeat(32),
    });
    // Two version bytes, OpBlake2b, a 32-byte push, the hash, OpEqual.
    expect(scriptPublicKeyHex).toMatch(/^0000aa20[0-9a-f]{64}87$/);
  });

  it("moves the prize to a new address when the phase changes", () => {
    const platformPublicKeyHex = "5e".repeat(32);
    const open = buildGiveawayPrizeV4Address({
      platformPublicKeyHex,
      stateHashHex: "01".repeat(32),
    });
    const frozen = buildGiveawayPrizeV4Address({
      platformPublicKeyHex,
      stateHashHex: "02".repeat(32),
    });
    expect(open.address).not.toBe(frozen.address);
  });

  it("derives the same address twice for the same giveaway", () => {
    const args = { platformPublicKeyHex: "5e".repeat(32), stateHashHex: "44".repeat(32) };
    expect(buildGiveawayPrizeV4Address(args).address).toBe(
      buildGiveawayPrizeV4Address(args).address,
    );
  });

  it("gives a different platform key a different address for the same state", () => {
    const stateHashHex = "33".repeat(32);
    const a = buildGiveawayPrizeV4Address({ platformPublicKeyHex: "5e".repeat(32), stateHashHex });
    const b = buildGiveawayPrizeV4Address({ platformPublicKeyHex: "ab".repeat(32), stateHashHex });
    expect(a.address).not.toBe(b.address);
  });
});
