/** Offline-only transaction construction. Compute budget and fee are caller-supplied lab values. */
import { createRequire } from "node:module";
import {
  buildEscrowV1Address,
  buildEscrowV1Witness,
  type EscrowV1Parameters,
  type EscrowV1Phase,
  ESCROW_V1_TAGS,
} from "./escrow-v1";
const sdk = () => createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
export type EscrowV1Spend = {
  parameters: EscrowV1Parameters;
  phase: EscrowV1Phase;
  mode: keyof typeof ESCROW_V1_TAGS;
  utxo: {
    transactionId: string;
    index: number;
    amount: string;
    blockDaaScore: string;
    scriptPublicKeyHex: string;
  };
  computeBudget: number;
  /** Required for settlement, using only the two committed recipient scripts. */
  buyerShare?: bigint;
};
const decimal = (s: string) => {
  if (!/^(0|[1-9][0-9]*)$/.test(s)) throw new Error("Invalid escrow integer.");
  return BigInt(s);
};
export const ESCROW_EMPTY_SIGNATURE = "00".repeat(64) + "01";
export function buildEscrowV1Transaction(input: EscrowV1Spend, signatures?: string[]) {
  const { parameters: p, phase, mode, utxo } = input;
  if (
    !/^[0-9a-f]{64}$/.test(utxo.transactionId) ||
    !Number.isInteger(utxo.index) ||
    utxo.index < 0 ||
    utxo.index > 0xffffffff
  )
    throw new Error("Invalid escrow outpoint.");
  if (
    !Number.isInteger(input.computeBudget) ||
    input.computeBudget < 0 ||
    input.computeBudget > 65535
  )
    throw new Error("Invalid compute budget.");
  const wasm = sdk(),
    terms = buildEscrowV1Address(p, phase);
  if (utxo.scriptPublicKeyHex !== terms.scriptPublicKeyHex)
    throw new Error("UTXO does not match the committed escrow.");
  const expected = phase === "active" ? p.amount + p.fee : p.amount;
  if (decimal(utxo.amount) !== expected)
    throw new Error("Escrow input amount differs from the commitment.");
  if (decimal(utxo.blockDaaScore) > (1n << 64n) - 1n) throw new Error("Invalid block DAA score.");
  const signatureList =
    signatures ?? Array.from({ length: mode === "settle" ? 2 : 1 }, () => ESCROW_EMPTY_SIGNATURE);
  const witness = buildEscrowV1Witness(p, phase, mode, signatureList);
  // The vendored SDK encoder retains the legacy 520-byte element limit.
  // This fixed post-Toccata contract uses canonical OP_PUSHDATA2 instead;
  // the covenant-enabled Rust engine separately verifies this script size.
  const scriptBytes = terms.redeemScriptHex.length / 2;
  if (scriptBytes <= 255 || scriptBytes > 65535) throw new Error("Unexpected escrow script size.");
  const size = Buffer.alloc(2);
  size.writeUInt16LE(scriptBytes);
  const signatureScript = witness + "4d" + size.toString("hex") + terms.redeemScriptHex;
  const spk = (value: string) => ({ version: 0, script: value.slice(4) });
  const net = expected - p.fee;
  let outputs: { value: string; scriptPublicKey: { version: number; script: string } }[];
  if (mode === "settle") {
    if (typeof input.buyerShare !== "bigint" || input.buyerShare < 0n || input.buyerShare > net)
      throw new Error("Invalid settlement split.");
    outputs = [
      { value: input.buyerShare.toString(), scriptPublicKey: spk(p.buyerScriptPublicKey) },
      { value: (net - input.buyerShare).toString(), scriptPublicKey: spk(p.sellerScriptPublicKey) },
    ].filter((o) => BigInt(o.value) > 0n);
  } else {
    if (input.buyerShare !== undefined) throw new Error("Only settlement accepts a split.");
    const target =
      mode === "freeze"
        ? buildEscrowV1Address(p, "frozen").scriptPublicKeyHex
        : mode === "refund"
          ? p.buyerScriptPublicKey
          : p.sellerScriptPublicKey;
    outputs = [{ value: net.toString(), scriptPublicKey: spk(target) }];
  }
  const tx = wasm.Transaction.deserializeFromSafeJSON(
    JSON.stringify({
      version: 1,
      id: "00".repeat(32),
      gas: "0",
      payload: "",
      subnetworkId: "00".repeat(20),
      lockTime: mode === "claim" ? p.releaseAfter.toString() : "0",
      inputs: [
        {
          transactionId: utxo.transactionId,
          index: utxo.index,
          computeBudget: input.computeBudget,
          sigOpCount: 0,
          sequence: "0",
          signatureScript,
          utxo: {
            amount: utxo.amount,
            blockDaaScore: utxo.blockDaaScore,
            isCoinbase: false,
            scriptPublicKey: spk(terms.scriptPublicKeyHex),
          },
        },
      ],
      outputs,
    }),
  );
  tx.finalize();
  return {
    transactionSafeJson: tx.serializeToSafeJSON(),
    feeSompi: p.fee.toString(),
    unsigned: signatureList.some((s) => s === ESCROW_EMPTY_SIGNATURE),
  };
}
/** Compare the full canonical SDK transaction, allowing only witness replacement and derived ID. */
export function assertEscrowV1SigningIntent(expectedJson: string, returnedJson: string) {
  if (expectedJson.length > 100000 || returnedJson.length > 100000)
    throw new Error("Escrow transaction is too large.");
  const canonical = (value: string) => {
    const t = JSON.parse(sdk().Transaction.deserializeFromSafeJSON(value).serializeToSafeJSON());
    if (t.inputs.length !== 1) throw new Error("Expected one escrow input.");
    delete t.id;
    delete t.mass;
    t.inputs[0].signatureScript = "";
    return JSON.stringify(t);
  };
  if (canonical(expectedJson) !== canonical(returnedJson))
    throw new Error("Wallet changed the reviewed escrow transaction.");
}
