import { blake2b } from "@noble/hashes/blake2.js";

import type { GiveawayV6Outpoint } from "./giveaway-v6-reconstructor";

const MAX_U64 = (1n << 64n) - 1n;
const COVENANT_ID_DOMAIN = new TextEncoder().encode("CovenantID");

export type GiveawayV6GenesisOutput = {
  outputIndex: number;
  amountSompi: bigint;
  scriptPublicKeyHex: string;
};

/** Reproduces KIP-20's consensus covenant-id hash for one genesis output group. */
export function deriveGiveawayV6GenesisCovenantIdHex(
  genesisOutpoint: GiveawayV6Outpoint,
  outputs: readonly GiveawayV6GenesisOutput[],
): string {
  const transactionId = parseHex32(genesisOutpoint.transactionId, "genesis transaction ID");
  requireU32(genesisOutpoint.outputIndex, "genesis output index");
  if (outputs.length === 0) throw new Error("Genesis covenant output group must not be empty.");

  const hasher = blake2b.create({ dkLen: 32, key: COVENANT_ID_DOMAIN });
  hasher.update(transactionId);
  hasher.update(u32le(genesisOutpoint.outputIndex));
  hasher.update(u64le(BigInt(outputs.length)));

  let previousIndex = -1;
  for (const output of outputs) {
    requireU32(output.outputIndex, "genesis covenant output index");
    if (output.outputIndex <= previousIndex) {
      throw new Error("Genesis covenant outputs must be ordered by strictly increasing index.");
    }
    previousIndex = output.outputIndex;
    if (typeof output.amountSompi !== "bigint" || output.amountSompi < 0n) {
      throw new Error("Genesis covenant output amount must be a uint64 bigint.");
    }
    const serializedScript = parseSerializedScript(output.scriptPublicKeyHex);
    hasher.update(u32le(output.outputIndex));
    hasher.update(u64le(output.amountSompi));
    hasher.update(u16le(serializedScript.version));
    hasher.update(u64le(BigInt(serializedScript.script.length)));
    hasher.update(serializedScript.script);
  }
  return toHex(hasher.digest());
}

function parseSerializedScript(value: string): { version: number; script: Uint8Array } {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!/^[0-9a-f]+$/u.test(normalized) || normalized.length < 6 || normalized.length % 2 !== 0) {
    throw new Error("Script public key must be even-length hexadecimal with a version prefix.");
  }
  return {
    version: Number.parseInt(normalized.slice(0, 4), 16),
    script: fromHex(normalized.slice(4)),
  };
}

function parseHex32(value: string, label: string): Uint8Array {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/u.test(normalized)) throw new Error(`${label} must be 32-byte hex.`);
  return fromHex(normalized);
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireU32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} must be a uint32.`);
  }
}

function u16le(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64le(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_U64) throw new Error("Value must fit uint64.");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}
