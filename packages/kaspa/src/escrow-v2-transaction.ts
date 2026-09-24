/** Offline-only Escrow V2 transaction construction. Never connected to a relay. */
import { createRequire } from "node:module";

import {
  buildEscrowV2Address,
  buildEscrowV2Witness,
  type EscrowV2Mode,
  type EscrowV2Parameters,
  type EscrowV2Phase,
} from "./escrow-v2";

const sdk = () => createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
export const ESCROW_V2_EMPTY_SIGNATURE = "00".repeat(64) + "01";

export type EscrowV2Spend = {
  parameters: EscrowV2Parameters;
  phase: EscrowV2Phase;
  mode: Exclude<EscrowV2Mode, "recoverInvalidFunding">;
  utxo: {
    transactionId: string;
    index: number;
    amount: string;
    blockDaaScore: string;
    scriptPublicKeyHex: string;
  };
  computeBudget: number;
  buyerShare?: bigint;
  mediatorParty?: "buyer" | "seller";
};

function decimal(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) throw new Error("Invalid escrow integer.");
  return BigInt(value);
}

export function buildEscrowV2Transaction(input: EscrowV2Spend, signatures?: string[]) {
  const { parameters: p, phase, mode, utxo } = input;
  if ((mode as EscrowV2Mode) === "recoverInvalidFunding") {
    throw new Error("Invalid funding recovery requires a separately funded second input.");
  }
  if (
    !/^[0-9a-f]{64}$/u.test(utxo.transactionId) ||
    !Number.isInteger(utxo.index) ||
    utxo.index < 0 ||
    utxo.index > 0xffffffff
  ) {
    throw new Error("Invalid Escrow V2 outpoint.");
  }
  if (
    !Number.isInteger(input.computeBudget) ||
    input.computeBudget < 0 ||
    input.computeBudget > 65535
  ) {
    throw new Error("Invalid Escrow V2 compute budget.");
  }
  const address = buildEscrowV2Address(p, phase);
  if (utxo.scriptPublicKeyHex !== address.scriptPublicKeyHex) {
    throw new Error("UTXO does not match the committed Escrow V2 script.");
  }
  const expected = phase === "active" ? p.amount + p.fee : p.amount;
  if (decimal(utxo.amount) !== expected) throw new Error("Wrong Escrow V2 input amount.");
  if (decimal(utxo.blockDaaScore) > (1n << 64n) - 1n) throw new Error("Invalid UTXO DAA score.");
  const sigCount = mode === "agree" || mode === "arbitrate" ? 2 : 1;
  const signatureList =
    signatures ?? Array.from({ length: sigCount }, () => ESCROW_V2_EMPTY_SIGNATURE);
  const witness = buildEscrowV2Witness({
    parameters: p,
    phase,
    mode,
    signatures: signatureList,
    ...(input.buyerShare !== undefined ? { buyerShare: input.buyerShare } : {}),
    ...(input.mediatorParty !== undefined ? { mediatorParty: input.mediatorParty } : {}),
  });
  const scriptSize = address.redeemScriptHex.length / 2;
  if (scriptSize <= 255 || scriptSize > 65535) throw new Error("Unexpected V2 script size.");
  const size = Buffer.alloc(2);
  size.writeUInt16LE(scriptSize);
  const signatureScript = witness + "4d" + size.toString("hex") + address.redeemScriptHex;
  const spk = (value: string) => ({ version: 0, script: value.slice(4) });
  const net = expected - p.fee;
  let outputs: { value: string; scriptPublicKey: { version: number; script: string } }[];
  if (mode === "agree" || mode === "arbitrate") {
    const buyerShare = input.buyerShare!;
    outputs = [
      { value: buyerShare.toString(), scriptPublicKey: spk(p.buyerScriptPublicKey) },
      { value: (net - buyerShare).toString(), scriptPublicKey: spk(p.sellerScriptPublicKey) },
    ].filter((output) => BigInt(output.value) > 0n);
  } else {
    const target =
      mode === "freeze"
        ? buildEscrowV2Address(p, "frozen").scriptPublicKeyHex
        : mode === "refund"
          ? p.buyerScriptPublicKey
          : p.sellerScriptPublicKey;
    outputs = [{ value: net.toString(), scriptPublicKey: spk(target) }];
  }
  const sequence =
    mode === "claim" ? p.claimDelayDaa : mode === "fallbackSeller" ? p.fallbackDelayDaa : 0n;
  const transaction = sdk().Transaction.deserializeFromSafeJSON(
    JSON.stringify({
      version: 1,
      id: "00".repeat(32),
      gas: "0",
      payload: "",
      subnetworkId: "00".repeat(20),
      lockTime: "0",
      inputs: [
        {
          transactionId: utxo.transactionId,
          index: utxo.index,
          computeBudget: input.computeBudget,
          sigOpCount: 0,
          sequence: sequence.toString(),
          signatureScript,
          utxo: {
            amount: utxo.amount,
            blockDaaScore: utxo.blockDaaScore,
            isCoinbase: false,
            scriptPublicKey: spk(address.scriptPublicKeyHex),
          },
        },
      ],
      outputs,
    }),
  );
  transaction.finalize();
  return {
    transactionSafeJson: transaction.serializeToSafeJSON(),
    feeSompi: p.fee.toString(),
    unsigned: signatureList.some((signature) => signature === ESCROW_V2_EMPTY_SIGNATURE),
  };
}

/** Compare canonical transactions, allowing only the reviewed witness slots and derived ID. */
export function assertEscrowV2SigningIntent(expectedJson: string, returnedJson: string) {
  if (expectedJson.length > 100_000 || returnedJson.length > 100_000) {
    throw new Error("Escrow V2 transaction is too large.");
  }
  const parse = (value: string) => {
    const transaction = JSON.parse(
      sdk().Transaction.deserializeFromSafeJSON(value).serializeToSafeJSON(),
    );
    if (transaction.inputs.length !== 1) throw new Error("Expected one escrow input.");
    return transaction;
  };
  const expected = parse(expectedJson);
  const returned = parse(returnedJson);
  const normalizeWitness = (value: unknown, signatureCount: number) => {
    if (typeof value !== "string" || !/^(?:[0-9a-f]{2})+$/u.test(value)) {
      throw new Error("Invalid Escrow V2 witness.");
    }
    let offset = 0;
    let normalized = "";
    for (let index = 0; index < signatureCount; index += 1) {
      if (
        value.slice(offset, offset + 2) !== "41" ||
        value.slice(offset + 130, offset + 132) !== "01"
      ) {
        throw new Error("Escrow V2 witness must retain 65-byte SIGHASH_ALL slots.");
      }
      normalized += "41" + "00".repeat(64) + "01";
      offset += 132;
    }
    return normalized + value.slice(offset);
  };
  const expectedScript = expected.inputs[0].signatureScript as string;
  const count = expectedScript.slice(132, 134) === "41" ? 2 : 1;
  if (
    normalizeWitness(expectedScript, count) !==
    normalizeWitness(returned.inputs[0].signatureScript, count)
  ) {
    throw new Error("Wallet changed the reviewed Escrow V2 witness.");
  }
  const canonical = (transaction: typeof expected) => {
    delete transaction.id;
    delete transaction.mass;
    transaction.inputs[0].signatureScript = "";
    return JSON.stringify(transaction);
  };
  if (canonical(expected) !== canonical(returned)) {
    throw new Error("Wallet changed the reviewed Escrow V2 transaction.");
  }
}
