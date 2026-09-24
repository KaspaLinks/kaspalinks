import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import { buildEscrowV2Address, type EscrowV2Parameters } from "./escrow-v2";
import {
  assertEscrowV2SigningIntent,
  buildEscrowV2Transaction,
  type EscrowV2Spend,
} from "./escrow-v2-transaction";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const buyer = new sdk.PrivateKey("21".repeat(32));
const seller = new sdk.PrivateKey("22".repeat(32));
const mediator = new sdk.PrivateKey("23".repeat(32));
const publicKey = (privateKey: typeof buyer) =>
  privateKey.toPublicKey().toXOnlyPublicKey().toString();
const p: EscrowV2Parameters = {
  amount: 100_000_000n,
  fee: 20_000n,
  claimDelayDaa: 6_048_000n,
  fallbackDelayDaa: 25_920_000n,
  buyerPublicKey: publicKey(buyer),
  sellerPublicKey: publicKey(seller),
  mediatorPublicKey: publicKey(mediator),
  buyerScriptPublicKey: "00005161",
  sellerScriptPublicKey: "00005162",
};

function spend(
  mode: EscrowV2Spend["mode"],
  phase: EscrowV2Spend["phase"],
  extra: Partial<EscrowV2Spend> = {},
): EscrowV2Spend {
  return {
    parameters: p,
    mode,
    phase,
    computeBudget: 2_000,
    utxo: {
      transactionId: "ab".repeat(32),
      index: 0,
      amount: (phase === "active" ? p.amount + p.fee : p.amount).toString(),
      blockDaaScore: "1000",
      scriptPublicKeyHex: buildEscrowV2Address(p, phase).scriptPublicKeyHex,
    },
    ...extra,
  };
}

describe("Escrow V2 offline transactions", () => {
  for (const [mode, phase] of [
    ["release", "active"],
    ["refund", "active"],
    ["claim", "active"],
    ["freeze", "active"],
    ["refund", "frozen"],
    ["agree", "frozen"],
    ["arbitrate", "frozen"],
    ["fallbackSeller", "frozen"],
  ] as const) {
    it(`builds ${mode}/${phase} with exact fee and committed outputs`, () => {
      const input = spend(mode, phase, {
        ...(mode === "agree" || mode === "arbitrate" ? { buyerShare: 40_000_000n } : {}),
        ...(mode === "arbitrate" ? { mediatorParty: "buyer" } : {}),
      });
      const built = buildEscrowV2Transaction(input);
      const tx = JSON.parse(built.transactionSafeJson);
      expect(built.unsigned).toBe(true);
      expect(
        BigInt(tx.inputs[0].utxo.amount) -
          tx.outputs.reduce(
            (sum: bigint, output: { value: string }) => sum + BigInt(output.value),
            0n,
          ),
      ).toBe(p.fee);
      expect(tx.inputs[0].sequence).toBe(
        mode === "claim"
          ? p.claimDelayDaa.toString()
          : mode === "fallbackSeller"
            ? p.fallbackDelayDaa.toString()
            : "0",
      );
      if (mode === "agree" || mode === "arbitrate") {
        expect(tx.outputs.map((output: { value: string }) => output.value)).toEqual([
          "40000000",
          (p.amount - p.fee - 40_000_000n).toString(),
        ]);
      }
    });
  }

  it("allows full buyer or seller awards with one output", () => {
    const net = p.amount - p.fee;
    expect(
      JSON.parse(
        buildEscrowV2Transaction(
          spend("arbitrate", "frozen", { buyerShare: 0n, mediatorParty: "seller" }),
        ).transactionSafeJson,
      ).outputs,
    ).toHaveLength(1);
    expect(
      JSON.parse(
        buildEscrowV2Transaction(
          spend("arbitrate", "frozen", { buyerShare: net, mediatorParty: "buyer" }),
        ).transactionSafeJson,
      ).outputs,
    ).toHaveLength(1);
  });

  it("requires the exact outpoint and full transaction intent", () => {
    const input = spend("release", "active");
    const original = buildEscrowV2Transaction(input).transactionSafeJson;
    const changed = JSON.parse(original);
    changed.outputs[0].value = "1";
    expect(() => assertEscrowV2SigningIntent(original, JSON.stringify(changed))).toThrow(/changed/);
    const changedWitness = JSON.parse(original);
    const witness = changedWitness.inputs[0].signatureScript as string;
    changedWitness.inputs[0].signatureScript =
      witness.slice(0, -2) + (witness.endsWith("00") ? "01" : "00");
    expect(() => assertEscrowV2SigningIntent(original, JSON.stringify(changedWitness))).toThrow(
      /witness/,
    );
    const wrongSighash = JSON.parse(original);
    const signatureScript = wrongSighash.inputs[0].signatureScript as string;
    wrongSighash.inputs[0].signatureScript =
      signatureScript.slice(0, 130) + "02" + signatureScript.slice(132);
    expect(() => assertEscrowV2SigningIntent(original, JSON.stringify(wrongSighash))).toThrow(
      /SIGHASH_ALL/,
    );
    expect(() =>
      buildEscrowV2Transaction({ ...input, utxo: { ...input.utxo, amount: "1" } }),
    ).toThrow(/amount/);
    expect(() =>
      buildEscrowV2Transaction({ ...input, utxo: { ...input.utxo, scriptPublicKeyHex: "000051" } }),
    ).toThrow(/UTXO/);
  });

  it("rejects missing mediator role and invalid split", () => {
    expect(() =>
      buildEscrowV2Transaction(spend("arbitrate", "frozen", { buyerShare: 1n })),
    ).toThrow(/party role/);
    expect(() =>
      buildEscrowV2Transaction(spend("agree", "frozen", { buyerShare: p.amount })),
    ).toThrow(/buyer share/);
  });
});
