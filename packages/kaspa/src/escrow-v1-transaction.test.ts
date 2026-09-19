import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildEscrowV1Address, type EscrowV1Parameters } from "./escrow-v1";
import {
  buildEscrowV1Transaction,
  assertEscrowV1SigningIntent,
  type EscrowV1Spend,
} from "./escrow-v1-transaction";
import { requestEscrowWalletSignature } from "../../wallet-adapter/src/escrow-signing";
const sdk = createRequire(import.meta.url)("kaspa-wasm");
const buyer = new sdk.PrivateKey("21".repeat(32)),
  seller = new sdk.PrivateKey("22".repeat(32));
const p: EscrowV1Parameters = {
  amount: 100000000n,
  fee: 20000n,
  releaseAfter: 200000000n,
  buyerPublicKey: buyer.toPublicKey().toXOnlyPublicKey().toString(),
  sellerPublicKey: seller.toPublicKey().toXOnlyPublicKey().toString(),
  buyerScriptPublicKey: "00005161",
  sellerScriptPublicKey: "00005162",
};
function spend(mode: EscrowV1Spend["mode"], phase: EscrowV1Spend["phase"]): EscrowV1Spend {
  return {
    parameters: p,
    mode,
    phase,
    computeBudget: 2000,
    ...(mode === "settle" ? { buyerShare: 40000000n } : {}),
    utxo: {
      transactionId: "ab".repeat(32),
      index: 0,
      amount: (phase === "active" ? p.amount + p.fee : p.amount).toString(),
      blockDaaScore: "1000",
      scriptPublicKeyHex: buildEscrowV1Address(p, phase).scriptPublicKeyHex,
    },
  };
}
describe("escrow offline transaction signing", () => {
  for (const [mode, phase] of [
    ["release", "active"],
    ["refund", "active"],
    ["refund", "frozen"],
    ["claim", "active"],
    ["freeze", "active"],
    ["settle", "frozen"],
  ] as const) {
    it(`builds and signs ${mode}/${phase} without broadcasting`, async () => {
      const input = spend(mode, phase),
        unsigned = buildEscrowV1Transaction(input);
      let current = unsigned.transactionSafeJson;
      const keys =
        mode === "settle"
          ? [buyer, seller]
          : [mode === "release" || mode === "freeze" ? buyer : seller];
      const signatures: string[] = [];
      for (const [slot, key] of keys.entries()) {
        const provider = {
          signPskt: async ({
            txJsonString,
            options,
          }: {
            txJsonString: string;
            options?: unknown;
          }) => {
            expect(options).toEqual({ signInputs: [{ index: 0, sighashType: 1 }] });
            const tx = sdk.Transaction.deserializeFromSafeJSON(txJsonString);
            const sig = sdk.createInputSignature(tx, 0, key, sdk.SighashType.All);
            signatures.push(sig.slice(2));
            tx.inputs[0].signatureScript = sig;
            tx.finalize();
            return tx.serializeToSafeJSON();
          },
        };
        current = await requestEscrowWalletSignature(provider, {
          transactionSafeJson: current,
          signatureSlot: slot as 0 | 1,
          signatureCount: keys.length as 1 | 2,
        });
      }
      assertEscrowV1SigningIntent(unsigned.transactionSafeJson, current);
      expect(JSON.parse(current).inputs[0].signatureScript).toBe(
        JSON.parse(buildEscrowV1Transaction(input, signatures).transactionSafeJson).inputs[0]
          .signatureScript,
      );
      const tx = JSON.parse(current);
      expect(
        BigInt(tx.inputs[0].utxo.amount) -
          tx.outputs.reduce((n: bigint, o: { value: string }) => n + BigInt(o.value), 0n),
      ).toBe(p.fee);
      expect(tx.lockTime).toBe(mode === "claim" ? p.releaseAfter.toString() : "0");
    });
  }
  it("rejects wrong funding amount and outpoint script", () => {
    const s = spend("release", "active");
    expect(() => buildEscrowV1Transaction({ ...s, utxo: { ...s.utxo, amount: "1" } })).toThrow();
    expect(() =>
      buildEscrowV1Transaction({ ...s, utxo: { ...s.utxo, scriptPublicKeyHex: "000051" } }),
    ).toThrow();
  });
  it("rejects settlement overspending and negative shares", () => {
    const s = spend("settle", "frozen");
    for (const buyerShare of [-1n, p.amount])
      expect(() => buildEscrowV1Transaction({ ...s, buyerShare })).toThrow();
  });
  it("rejects wallet changes to outputs and preserves the reviewed witness", async () => {
    const original = buildEscrowV1Transaction(spend("release", "active")).transactionSafeJson;
    const changed = JSON.parse(original);
    changed.outputs[0].value = "1";
    await expect(
      requestEscrowWalletSignature(
        { signPskt: async () => JSON.stringify(changed) },
        { transactionSafeJson: original, signatureSlot: 0, signatureCount: 1 },
      ),
    ).rejects.toThrow(/changed/);
    expect(() => assertEscrowV1SigningIntent(original, JSON.stringify(changed))).toThrow(/changed/);
  });
  it("rejects invalid slots before calling the wallet", async () => {
    const original = buildEscrowV1Transaction(spend("release", "active")).transactionSafeJson;
    for (const signatureSlot of [-1, 0.5, 2, NaN]) {
      let called = false;
      await expect(
        requestEscrowWalletSignature(
          {
            signPskt: async () => {
              called = true;
              return original;
            },
          },
          {
            transactionSafeJson: original,
            signatureSlot: signatureSlot as 0,
            signatureCount: 1,
          },
        ),
      ).rejects.toThrow(/Invalid/);
      expect(called).toBe(false);
    }
  });
  it("rejects occupied slots, wrong sighash, missing signing and malformed replies", async () => {
    const original = buildEscrowV1Transaction(spend("release", "active")).transactionSafeJson;
    const input = {
      transactionSafeJson: original,
      signatureSlot: 0 as const,
      signatureCount: 1 as const,
    };
    await expect(requestEscrowWalletSignature({}, input)).rejects.toThrow(/does not expose/);
    for (const signature of ["41" + "aa".repeat(64) + "02", "41" + "00".repeat(64) + "01", "ff"]) {
      const response = JSON.parse(original);
      response.inputs[0].signatureScript = signature;
      await expect(
        requestEscrowWalletSignature({ signPskt: async () => JSON.stringify(response) }, input),
      ).rejects.toThrow(/SIGHASH_ALL/);
    }
    await expect(
      requestEscrowWalletSignature({ signPskt: async () => ({}) }, input),
    ).rejects.toThrow(/Unsupported/);
    const occupied = buildEscrowV1Transaction(spend("release", "active"), [
      "aa".repeat(64) + "01",
    ]).transactionSafeJson;
    await expect(
      requestEscrowWalletSignature(
        { signPskt: async () => original },
        { ...input, transactionSafeJson: occupied },
      ),
    ).rejects.toThrow(/occupied/);
  });
  it("rejects changes to the other signature and covenant bytes", async () => {
    const original = buildEscrowV1Transaction(spend("settle", "frozen"), [
      "aa".repeat(64) + "01",
      "00".repeat(64) + "01",
    ]).transactionSafeJson;
    for (const change of ["first-signature", "covenant"]) {
      const response = JSON.parse(original);
      const script: string = response.inputs[0].signatureScript;
      response.inputs[0].signatureScript =
        change === "first-signature"
          ? "41" + "bb".repeat(64) + "01" + script.slice(132)
          : script.slice(0, -2) + "ff";
      await expect(
        requestEscrowWalletSignature(
          { signPskt: async () => JSON.stringify(response) },
          {
            transactionSafeJson: original,
            signatureSlot: 1,
            signatureCount: 2,
          },
        ),
      ).rejects.toThrow(/SIGHASH_ALL/);
    }
  });
});
