import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildEscrowV1Address,
  buildEscrowV1Script,
  buildEscrowV1Witness,
  escrowV1Commitment,
  escrowV1Integer,
  ESCROW_V1_SOURCE_SHA256,
  ESCROW_V1_TEMPLATE_HASH,
  type EscrowV1Parameters,
} from "./escrow-v1";
const sdk = createRequire(import.meta.url)("kaspa-wasm");
const pk = (s: string) =>
  new sdk.PrivateKey(s.repeat(32)).toPublicKey().toXOnlyPublicKey().toString();
const p: EscrowV1Parameters = {
  amount: 100000000n,
  fee: 20000n,
  releaseAfter: 200000000n,
  buyerPublicKey: pk("21"),
  sellerPublicKey: pk("22"),
  buyerScriptPublicKey: "00005161",
  sellerScriptPublicKey: "00005162",
};
const vectors = JSON.parse(
  readFileSync(
    new URL("../../../labs/claimable-script/escrow_v1_ts_vectors.json", import.meta.url),
    "utf8",
  ),
);
describe("escrow V1 builder", () => {
  it("pins source, template and real-engine fixture scripts", () => {
    const source = readFileSync(
      new URL("../../../labs/claimable-script/escrow_v1.sil", import.meta.url),
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(ESCROW_V1_SOURCE_SHA256);
    expect(ESCROW_V1_TEMPLATE_HASH).toBe(
      "7f54b0335bdad1599cbddfc1a2a35f401ed1857ac5c9d89603d83bc8163772d9",
    );
    for (const v of vectors) {
      expect(buildEscrowV1Address(p, v.phase)).toMatchObject({
        address: v.address,
        redeemScriptHex: v.redeemScriptHex,
        scriptPublicKeyHex: v.scriptPublicKeyHex,
      });
      expect(
        buildEscrowV1Witness(
          p,
          v.phase,
          v.mode,
          v.mode === "settle"
            ? ["aa".repeat(64) + "01", "bb".repeat(64) + "01"]
            : ["aa".repeat(64) + "01"],
        ),
      ).toBe(v.witnessHex);
    }
  });
  it("encodes fixed width integers without losing precision", () => {
    expect(escrowV1Integer(1n)).toBe("0100000000000000");
    expect(escrowV1Integer((1n << 55n) - 1n)).toBe("ffffffffffff7f00");
    for (const bad of [0n, -1n, 1n << 55n]) expect(() => escrowV1Integer(bad)).toThrow();
  });
  it("binds every parameter and phase into the funding script", () => {
    const original = buildEscrowV1Script(p, "active");
    expect(original.length / 2).toBe(962);
    for (const [field, value] of Object.entries({
      amount: 100000001n,
      fee: 20001n,
      releaseAfter: 200000001n,
      buyerPublicKey: pk("23"),
      sellerPublicKey: pk("24"),
      buyerScriptPublicKey: "00005163",
      sellerScriptPublicKey: "00005164",
    })) {
      expect(buildEscrowV1Script({ ...p, [field]: value }, "active")).not.toBe(original);
    }
    expect(buildEscrowV1Script(p, "frozen")).not.toBe(original);
    expect(buildEscrowV1Address(p, "active", "testnet-10").address).toMatch(/^kaspatest:/);
  });
  it("rejects unaffordable frozen refunds and invalid public keys", () => {
    expect(() => escrowV1Commitment({ ...p, fee: p.amount }, "active")).toThrow();
    expect(() => escrowV1Commitment({ ...p, buyerPublicKey: "ff".repeat(32) }, "active")).toThrow();
    expect(() => escrowV1Commitment({ ...p, buyerScriptPublicKey: "010051" }, "active")).toThrow();
  });
  it("requires every signature to cover all outputs", () => {
    expect(() => buildEscrowV1Witness(p, "active", "release", ["aa".repeat(64) + "02"])).toThrow(
      /SIGHASH_ALL/,
    );
    expect(() => buildEscrowV1Witness(p, "frozen", "settle", ["aa".repeat(64) + "01"])).toThrow(
      /count/,
    );
    expect(() => buildEscrowV1Witness(p, "active", "settle", [])).toThrow(/phase/);
    for (const mode of ["release", "freeze", "claim"] as const)
      expect(() => buildEscrowV1Witness(p, "frozen", mode, [])).toThrow(/phase/);
  });
});
