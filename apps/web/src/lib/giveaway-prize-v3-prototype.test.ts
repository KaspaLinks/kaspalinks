import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  buildPrototypeTransaction,
  createPrototypeManifest,
  prototypeCreateSchema,
  prototypeTerms,
  prototypeWitness,
  validatePrototypeRefundTransaction,
} from "./giveaway-prize-v3-prototype";
const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const key = new sdk.PrivateKey("22".repeat(32));
const publicKey = key.toPublicKey().toXOnlyPublicKey();
const address = (n: string) =>
  new sdk.PrivateKey(n.repeat(32)).toPublicKey().toAddress("mainnet").toString();
const make = () =>
  createPrototypeManifest(
    {
      creatorPublicKeyHex: publicKey.toString(),
      prizeSompi: "100000000",
      addresses: [address("33"), address("44")],
    },
    {
      daa: 536_000_000n,
      blueScore: 535_000_000n,
      platformPublicKeyHex: new sdk.PrivateKey("11".repeat(32))
        .toPublicKey()
        .toXOnlyPublicKey()
        .toString(),
    },
  );
const utxo = {
  transactionId: "ab".repeat(32),
  index: 0,
  amount: "102000000",
  blockDaaScore: "536000100",
};

describe("mainnet covenant prototype", () => {
  it("commits fixed unique entrants and future entropy before funding", () => {
    const m = make();
    expect(m.entries.map((e) => e.hash)).toEqual(m.entries.map((e) => e.hash).sort());
    expect(m.entropyTargetBlueScore).toBe("535003600");
    expect(prototypeTerms(m).fundingSompi).toBe("102000000");
    expect(() =>
      createPrototypeManifest(
        {
          creatorPublicKeyHex: publicKey.toString(),
          prizeSompi: "100000000",
          addresses: [address("33"), address("33")],
        },
        { daa: 1n, blueScore: 1n, platformPublicKeyHex: publicKey.toString() },
      ),
    ).toThrow(/only once/);
  });
  it("bounds mainnet prize and participant count", () => {
    expect(
      prototypeCreateSchema.safeParse({
        creatorPublicKeyHex: publicKey.toString(),
        prizeSompi: "100000001",
        addresses: [address("33"), address("44")],
      }).success,
    ).toBe(false);
  });
  it("builds a v1 freeze with one exact frozen output and a sufficient fee", () => {
    const m = make();
    const result = buildPrototypeTransaction({
      manifest: m,
      mode: "freeze",
      phase: "open",
      utxo,
      signatureHex: "55".repeat(64),
    });
    const tx = JSON.parse(result.transactionSafeJson);
    expect(tx.version).toBe(1);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0].value).toBe("101000000");
    expect(tx.lockTime).toBe(m.closesAtDaa);
    expect(BigInt(result.feeSompi)).toBeGreaterThan(BigInt(result.minimumFeeSompi));
    expect(BigInt(result.minimumFeeSompi)).toBeGreaterThan(500_000n);
  });
  it("uses the Toccata builder for the long redeem script", () => {
    const m = make();
    expect(() =>
      sdk.payToScriptHashSignatureScript(prototypeTerms(m).open.redeemScriptHex, ""),
    ).toThrow();
    expect(
      prototypeWitness(m, "freeze", "open", "55".repeat(64)).signatureScriptHex.length,
    ).toBeGreaterThan(1492);
  });
  it("draws directly to the selected entrant and preserves the exact prize", () => {
    const m = make();
    const result = buildPrototypeTransaction({
      manifest: m,
      mode: "draw",
      phase: "frozen",
      utxo: { ...utxo, amount: "101000000" },
      signatureHex: "55".repeat(64),
      entropy: {
        blockHash: "7a".repeat(32),
        seedHex: "5c".repeat(32),
        blockBlueScore: m.entropyTargetBlueScore,
      },
    });
    const tx = JSON.parse(result.transactionSafeJson);
    expect(tx.outputs[0].value).toBe(m.prizeSompi);
    expect(m.entries.map((e) => e.address)).toContain(result.winnerAddress);
    expect(tx.outputs[0].scriptPublicKey).toBe(
      "0000" + sdk.payToAddressScript(result.winnerAddress!).script,
    );
  });
  it.each(["open", "frozen"] as const)(
    "accepts only an unchanged SIGHASH_ALL refund from %s",
    (phase) => {
      const m = make();
      const prepared = buildPrototypeTransaction({
        manifest: m,
        mode: "refund",
        phase,
        utxo: { ...utxo, amount: phase === "open" ? "102000000" : "101000000" },
        signatureHex: "00".repeat(65),
        refundAddress: address("22"),
      });
      const tx = sdk.Transaction.deserializeFromSafeJSON(prepared.transactionSafeJson);
      const input = tx.inputs[0]!;
      input.signatureScript =
        sdk.createInputSignature(tx, 0, key, sdk.SighashType.All) +
        input.signatureScript!.slice(132);
      tx.finalize();
      expect(
        validatePrototypeRefundTransaction(tx.serializeToSafeJSON(), prepared.transactionSafeJson),
      ).toBe(tx.serializeToSafeJSON());
      const tampered = JSON.parse(tx.serializeToSafeJSON());
      tampered.outputs[0].scriptPublicKey = sdk.payToAddressScript(address("55")).toJSON();
      expect(() =>
        validatePrototypeRefundTransaction(JSON.stringify(tampered), prepared.transactionSafeJson),
      ).toThrow(/differs/);
    },
  );
  it("allows recovery of an accidental overpayment", () => {
    const m = make();
    const result = buildPrototypeTransaction({
      manifest: m,
      mode: "refund",
      phase: "open",
      utxo: { ...utxo, amount: "160000000" },
      signatureHex: "00".repeat(65),
      refundAddress: address("22"),
    });
    expect(JSON.parse(result.transactionSafeJson).outputs[0].value).toBe("159000000");
    expect(() =>
      buildPrototypeTransaction({
        manifest: m,
        mode: "freeze",
        phase: "open",
        utxo: { ...utxo, amount: "160000000" },
        signatureHex: "55".repeat(64),
      }),
    ).toThrow(/exactly/);
  });
});

describe("prototype duration", () => {
  it("preserves the legacy five-minute default and rejects unsupported durations", () => {
    expect(make().closesAtDaa).toBe("536003000");
    const input = {
      creatorPublicKeyHex: publicKey.toString(),
      prizeSompi: "100000000",
      addresses: [address("33"), address("44")],
    };
    for (const durationMinutes of [0, -5, 6, 1440, "15"])
      expect(prototypeCreateSchema.safeParse({ ...input, durationMinutes }).success).toBe(false);
    for (const durationMinutes of [5, 15, 30, 60] as const) {
      const manifest = createPrototypeManifest(
        { ...input, durationMinutes },
        { daa: 100n, blueScore: 200n, platformPublicKeyHex: publicKey.toString() },
      );
      expect(BigInt(manifest.closesAtDaa)).toBe(100n + BigInt(durationMinutes) * 600n);
      expect(BigInt(manifest.refundDaa) - BigInt(manifest.closesAtDaa)).toBe(33000n);
      expect(BigInt(manifest.entropyTargetBlueScore)).toBe(
        200n + BigInt(durationMinutes) * 600n + 600n,
      );
    }
  });
});
