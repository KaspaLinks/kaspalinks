/** Lab-only V1 builder. No signing, network I/O or fee estimation. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { ESCROW_V1_TEMPLATE_HEX, ESCROW_V1_TEMPLATE_HASH } from "./escrow-v1-artifact";
export { ESCROW_V1_SOURCE_SHA256, ESCROW_V1_TEMPLATE_HASH } from "./escrow-v1-artifact";
const sdk = () => createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
export const ESCROW_V1_TAGS = {
  release: "8c7728a9",
  refund: "3198e8f6",
  claim: "8fd20cef",
  freeze: "11456534",
  settle: "a4fb823d",
} as const;
export type EscrowV1Phase = "active" | "frozen";
export type EscrowV1Parameters = {
  amount: bigint;
  fee: bigint;
  releaseAfter: bigint;
  buyerPublicKey: string;
  sellerPublicKey: string;
  buyerScriptPublicKey: string;
  sellerScriptPublicKey: string;
};
function hex(value: string, bytes?: number): string {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value) || (bytes !== undefined && value.length !== bytes * 2))
    throw new Error("Invalid escrow hex.");
  return value.toLowerCase();
}
const hash = (value: string) =>
  createHash("sha256").update(Buffer.from(value, "hex")).digest("hex");
export function escrowV1Integer(value: bigint): string {
  if (typeof value !== "bigint" || value <= 0n || value >= 1n << 55n)
    throw new Error("Escrow integer must be positive and below 2^55.");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes.toString("hex");
}
function fields(p: EscrowV1Parameters): string[] {
  if (p.amount <= p.fee) throw new Error("Escrow must cover the frozen refund fee.");
  escrowV1Integer(p.amount + p.fee);
  const keys = [hex(p.buyerPublicKey, 32), hex(p.sellerPublicKey, 32)];
  for (const key of keys) new (sdk().PublicKey)(key);
  const scripts = [p.buyerScriptPublicKey, p.sellerScriptPublicKey].map((value) => {
    const normalized = hex(value);
    if (!normalized.startsWith("0000") || normalized.length <= 4)
      throw new Error("Expected a version-zero payout script.");
    return normalized;
  });
  return [
    escrowV1Integer(p.amount),
    escrowV1Integer(p.fee),
    escrowV1Integer(p.releaseAfter),
    ...keys,
    ...scripts.map(hash),
  ];
}
function phaseByte(phase: EscrowV1Phase) {
  if (phase !== "active" && phase !== "frozen") throw new Error("Invalid escrow phase.");
  return phase === "active" ? "00" : "01";
}
export function escrowV1Commitment(p: EscrowV1Parameters, phase: EscrowV1Phase) {
  const paramsHash = hash(fields(p).join(""));
  return { paramsHash, stateHash: hash(phaseByte(phase) + paramsHash) };
}
export function buildEscrowV1Script(p: EscrowV1Parameters, phase: EscrowV1Phase) {
  const { stateHash } = escrowV1Commitment(p, phase);
  if (ESCROW_V1_TEMPLATE_HEX.slice(0, 4) !== "6b20")
    throw new Error("Escrow artifact state span changed.");
  return ESCROW_V1_TEMPLATE_HEX.slice(0, 4) + stateHash + ESCROW_V1_TEMPLATE_HEX.slice(68);
}
export function buildEscrowV1Address(
  p: EscrowV1Parameters,
  phase: EscrowV1Phase,
  network: "mainnet" | "testnet-10" = "mainnet",
) {
  if (network !== "mainnet" && network !== "testnet-10") throw new Error("Invalid escrow network.");
  const wasm = sdk(),
    redeemScriptHex = buildEscrowV1Script(p, phase);
  const spk = wasm.payToScriptHashScript(redeemScriptHex);
  const address = wasm.addressFromScriptPublicKey(spk, network);
  if (!address) throw new Error("Cannot derive escrow address.");
  const json = spk.toJSON() as { version: number; script: string };
  return {
    address: address.toString(),
    redeemScriptHex,
    scriptPublicKeyHex: json.version.toString(16).padStart(4, "0") + json.script,
    templateHash: ESCROW_V1_TEMPLATE_HASH,
  };
}
/** Signatures must use SIGHASH_ALL (65th byte 01), including both settlement signatures. */
export function buildEscrowV1Witness(
  p: EscrowV1Parameters,
  phase: EscrowV1Phase,
  mode: keyof typeof ESCROW_V1_TAGS,
  signatures: string[],
) {
  phaseByte(phase);
  if (!Object.hasOwn(ESCROW_V1_TAGS, mode)) throw new Error("Invalid escrow entry.");
  if (
    (mode === "settle" && phase !== "frozen") ||
    (phase === "frozen" && mode !== "refund" && mode !== "settle")
  )
    throw new Error("Entry is unavailable in this phase.");
  if (signatures.length !== (mode === "settle" ? 2 : 1)) throw new Error("Wrong signature count.");
  const args = signatures.map((s) => {
    const v = hex(s, 65);
    if (!v.endsWith("01")) throw new Error("Escrow requires SIGHASH_ALL.");
    return v;
  });
  args.push(...fields(p));
  if (mode === "release" || mode === "claim") args.push(hex(p.sellerScriptPublicKey));
  if (mode === "refund") args.push(phaseByte(phase), hex(p.buyerScriptPublicKey));
  const b = new (sdk().ScriptBuilder)();
  for (const arg of args) b.addData(arg);
  b.addData(ESCROW_V1_TAGS[mode]);
  return b.toString();
}
