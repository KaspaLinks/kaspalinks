import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ESCROW_V2_SOURCE_SHA256,
  ESCROW_V2_TAGS,
  ESCROW_V2_TEMPLATE_HASH,
} from "./escrow-v2-artifact";
import {
  buildEscrowV2Address,
  buildEscrowV2Script,
  buildEscrowV2Witness,
  escrowV2Commitment,
  type EscrowV2Parameters,
} from "./escrow-v2";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const pk = (byte: string) =>
  new sdk.PrivateKey(byte.repeat(32)).toPublicKey().toXOnlyPublicKey().toString();
const sig = "aa".repeat(64) + "01";
const p: EscrowV2Parameters = {
  amount: 100_000_000n,
  fee: 20_000n,
  claimDelayDaa: 6_048_000n, // seven days at ten DAA units per second
  fallbackDelayDaa: 25_920_000n, // thirty days from the frozen output
  buyerPublicKey: pk("21"),
  sellerPublicKey: pk("22"),
  mediatorPublicKey: pk("23"),
  buyerScriptPublicKey: "00005161",
  sellerScriptPublicKey: "00005162",
};

describe("Escrow V2 offline covenant builder", () => {
  it("pins the compiled source and binds each deal term to the state hash", () => {
    const source = readFileSync(
      new URL("../../../labs/claimable-script/escrow_v2.sil", import.meta.url),
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(ESCROW_V2_SOURCE_SHA256);
    expect(ESCROW_V2_TEMPLATE_HASH).toMatch(/^[0-9a-f]{64}$/u);
    const original = buildEscrowV2Script(p, "active");
    expect(original.length / 2).toBe(2615);
    for (const [field, value] of Object.entries({
      amount: p.amount + 1n,
      fee: p.fee + 1n,
      claimDelayDaa: p.claimDelayDaa + 1n,
      fallbackDelayDaa: p.fallbackDelayDaa + 1n,
      buyerPublicKey: pk("24"),
      sellerPublicKey: pk("25"),
      mediatorPublicKey: pk("26"),
      buyerScriptPublicKey: "00005163",
      sellerScriptPublicKey: "00005164",
    })) {
      expect(buildEscrowV2Script({ ...p, [field]: value }, "active")).not.toBe(original);
    }
    expect(buildEscrowV2Script(p, "frozen")).not.toBe(original);
    expect(escrowV2Commitment(p, "active").paramsHash).toBe(
      escrowV2Commitment(p, "frozen").paramsHash,
    );
  });

  it("derives different active and frozen addresses on mainnet and testnet", () => {
    const active = buildEscrowV2Address(p, "active");
    const frozen = buildEscrowV2Address(p, "frozen");
    expect(active.address).toMatch(/^kaspa:/u);
    expect(frozen.address).toMatch(/^kaspa:/u);
    expect(frozen.address).not.toBe(active.address);
    expect(buildEscrowV2Address(p, "active", "testnet-10").address).toMatch(/^kaspatest:/u);
  });

  it("builds witnesses only for the correct role and state", () => {
    for (const mode of ["release", "refund", "claim", "freeze", "recoverInvalidFunding"] as const) {
      const witness = buildEscrowV2Witness({
        parameters: p,
        phase: "active",
        mode,
        signatures: [sig],
      });
      expect(witness).toContain(ESCROW_V2_TAGS[mode]);
    }
    for (const mode of ["refund", "fallbackSeller"] as const) {
      expect(
        buildEscrowV2Witness({ parameters: p, phase: "frozen", mode, signatures: [sig] }),
      ).toContain(ESCROW_V2_TAGS[mode]);
    }
    for (const mode of ["agree", "arbitrate"] as const) {
      expect(
        buildEscrowV2Witness({
          parameters: p,
          phase: "frozen",
          mode,
          signatures: [sig, sig],
          buyerShare: 40_000_000n,
          ...(mode === "arbitrate" ? { mediatorParty: "buyer" as const } : {}),
        }),
      ).toContain(ESCROW_V2_TAGS[mode]);
    }
    expect(() =>
      buildEscrowV2Witness({
        parameters: p,
        phase: "active",
        mode: "arbitrate",
        signatures: [sig, sig],
        buyerShare: 1n,
        mediatorParty: "buyer",
      }),
    ).toThrow(/phase/);
    expect(() =>
      buildEscrowV2Witness({ parameters: p, phase: "frozen", mode: "claim", signatures: [sig] }),
    ).toThrow(/phase/);
    expect(() =>
      buildEscrowV2Witness({
        parameters: p,
        phase: "frozen",
        mode: "recoverInvalidFunding",
        signatures: [sig],
      }),
    ).toThrow(/phase/);
  });

  it("rejects redirected or under-committed signer roles at the builder boundary", () => {
    expect(() =>
      escrowV2Commitment({ ...p, mediatorPublicKey: p.buyerPublicKey }, "active"),
    ).toThrow(/distinct/);
    expect(() => escrowV2Commitment({ ...p, fee: p.amount }, "active")).toThrow(/cover/);
    expect(() => escrowV2Commitment({ ...p, fallbackDelayDaa: 1n << 32n }, "active")).toThrow(
      /delay/,
    );
    expect(() =>
      buildEscrowV2Witness({
        parameters: p,
        phase: "frozen",
        mode: "arbitrate",
        signatures: [sig, sig],
        buyerShare: p.amount,
        mediatorParty: "seller",
      }),
    ).toThrow(/share/);
    expect(() =>
      buildEscrowV2Witness({
        parameters: p,
        phase: "active",
        mode: "release",
        signatures: ["aa".repeat(64) + "02"],
      }),
    ).toThrow(/SIGHASH_ALL/);
  });
});
