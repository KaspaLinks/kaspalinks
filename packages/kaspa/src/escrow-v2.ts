/** Offline Escrow V2 builder. No signing, broadcasting, or live route uses it yet. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import {
  ESCROW_V2_TAGS,
  ESCROW_V2_TEMPLATE_HASH,
  ESCROW_V2_TEMPLATE_HEX,
} from "./escrow-v2-artifact";

const sdk = () => createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");

export type EscrowV2Phase = "active" | "frozen";
export type EscrowV2Mode = keyof typeof ESCROW_V2_TAGS;

export type EscrowV2Parameters = {
  amount: bigint;
  fee: bigint;
  claimDelayDaa: bigint;
  fallbackDelayDaa: bigint;
  buyerPublicKey: string;
  sellerPublicKey: string;
  mediatorPublicKey: string;
  buyerScriptPublicKey: string;
  sellerScriptPublicKey: string;
};

function hex(value: string, bytes?: number): string {
  if (
    !/^(?:[0-9a-fA-F]{2})+$/u.test(value) ||
    (bytes !== undefined && value.length !== bytes * 2)
  ) {
    throw new Error("Invalid Escrow V2 hex.");
  }
  return value.toLowerCase();
}

const sha256 = (value: string) =>
  createHash("sha256").update(Buffer.from(value, "hex")).digest("hex");

export function assertEscrowV2PublicKey(value: string): string {
  const normalized = hex(value, 32);
  new (sdk().PublicKey)(normalized);
  return normalized;
}

function integer(value: bigint): string {
  if (typeof value !== "bigint" || value <= 0n || value >= 1n << 55n) {
    throw new Error("Invalid Escrow V2 integer.");
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes.toString("hex");
}

function fields(p: EscrowV2Parameters): string[] {
  if (p.amount <= p.fee) throw new Error("Escrow amount must cover a disputed exit fee.");
  integer(p.amount + p.fee);
  if (p.claimDelayDaa >= 1n << 32n || p.fallbackDelayDaa >= 1n << 32n) {
    throw new Error("Escrow relative DAA delay is too large.");
  }
  const keys = [p.buyerPublicKey, p.sellerPublicKey, p.mediatorPublicKey].map(
    assertEscrowV2PublicKey,
  );
  if (new Set(keys).size !== 3) throw new Error("Escrow signer keys must be distinct.");
  const scripts = [p.buyerScriptPublicKey, p.sellerScriptPublicKey].map((value) => {
    const normalized = hex(value);
    if (!normalized.startsWith("0000") || normalized.length <= 4) {
      throw new Error("Expected a version-zero payout script.");
    }
    return normalized;
  });
  return [
    integer(p.amount),
    integer(p.fee),
    integer(p.claimDelayDaa),
    integer(p.fallbackDelayDaa),
    ...keys,
    ...scripts.map(sha256),
  ];
}

function phaseByte(phase: EscrowV2Phase): string {
  if (phase !== "active" && phase !== "frozen") throw new Error("Invalid Escrow V2 phase.");
  return phase === "active" ? "00" : "01";
}

export function escrowV2Commitment(p: EscrowV2Parameters, phase: EscrowV2Phase) {
  const paramsHash = sha256(fields(p).join(""));
  return { paramsHash, stateHash: sha256(phaseByte(phase) + paramsHash) };
}

export function buildEscrowV2Script(p: EscrowV2Parameters, phase: EscrowV2Phase) {
  const { stateHash } = escrowV2Commitment(p, phase);
  if (ESCROW_V2_TEMPLATE_HEX.slice(0, 68) !== "6b20" + "00".repeat(32)) {
    throw new Error("Escrow V2 artifact state span changed.");
  }
  return ESCROW_V2_TEMPLATE_HEX.slice(0, 4) + stateHash + ESCROW_V2_TEMPLATE_HEX.slice(68);
}

export function buildEscrowV2Address(
  p: EscrowV2Parameters,
  phase: EscrowV2Phase,
  network: "mainnet" | "testnet-10" = "mainnet",
) {
  if (network !== "mainnet" && network !== "testnet-10") throw new Error("Invalid escrow network.");
  const wasm = sdk();
  const redeemScriptHex = buildEscrowV2Script(p, phase);
  const spk = wasm.payToScriptHashScript(redeemScriptHex);
  const address = wasm.addressFromScriptPublicKey(spk, network);
  if (!address) throw new Error("Cannot derive Escrow V2 address.");
  const json = spk.toJSON() as { version: number; script: string };
  return {
    address: address.toString(),
    redeemScriptHex,
    scriptPublicKeyHex: json.version.toString(16).padStart(4, "0") + json.script,
    templateHash: ESCROW_V2_TEMPLATE_HASH,
  };
}

export type EscrowV2WitnessInput = {
  parameters: EscrowV2Parameters;
  phase: EscrowV2Phase;
  mode: EscrowV2Mode;
  signatures: string[];
  buyerShare?: bigint;
  mediatorParty?: "buyer" | "seller";
};

/** Every signature must be a 64-byte Schnorr signature plus SIGHASH_ALL. */
export function buildEscrowV2Witness(input: EscrowV2WitnessInput) {
  const { parameters: p, phase, mode } = input;
  phaseByte(phase);
  if (!Object.hasOwn(ESCROW_V2_TAGS, mode)) throw new Error("Invalid Escrow V2 entry.");
  if (
    (phase === "active" && ["agree", "arbitrate", "fallbackSeller"].includes(mode)) ||
    (phase === "frozen" && ["release", "claim", "freeze", "recoverInvalidFunding"].includes(mode))
  ) {
    throw new Error("Escrow V2 entry is unavailable in this phase.");
  }
  const joint = mode === "agree" || mode === "arbitrate";
  if (input.signatures.length !== (joint ? 2 : 1)) throw new Error("Wrong signature count.");
  if (joint) {
    const net = p.amount - p.fee;
    if (typeof input.buyerShare !== "bigint" || input.buyerShare < 0n || input.buyerShare > net) {
      throw new Error("Invalid Escrow V2 buyer share.");
    }
  } else if (input.buyerShare !== undefined) {
    throw new Error("Only a joint exit accepts a buyer share.");
  }
  if (mode === "arbitrate") {
    if (input.mediatorParty !== "buyer" && input.mediatorParty !== "seller") {
      throw new Error("Mediator resolution requires a party role.");
    }
  } else if (input.mediatorParty !== undefined) {
    throw new Error("Only mediator resolution accepts a party role.");
  }
  const b = new (sdk().ScriptBuilder)();
  for (const signature of input.signatures) {
    const value = hex(signature, 65);
    if (!value.endsWith("01")) throw new Error("Escrow V2 requires SIGHASH_ALL.");
    b.addData(value);
  }
  for (const field of fields(p)) b.addData(field);
  if (mode === "release" || mode === "claim" || mode === "fallbackSeller") {
    b.addData(hex(p.sellerScriptPublicKey));
  }
  if (mode === "refund") {
    b.addData(phaseByte(phase));
    b.addData(hex(p.buyerScriptPublicKey));
  }
  if (mode === "recoverInvalidFunding") b.addData(hex(p.buyerScriptPublicKey));
  if (mode === "agree" || mode === "arbitrate") {
    if (mode === "arbitrate") b.addData(input.mediatorParty === "buyer" ? "00" : "01");
    b.addI64(input.buyerShare!);
    b.addData(hex(p.buyerScriptPublicKey));
    b.addData(hex(p.sellerScriptPublicKey));
  }
  b.addData(ESCROW_V2_TAGS[mode]);
  return b.toString();
}
