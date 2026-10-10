import { createHash } from "node:crypto";

import { blake2b } from "@noble/hashes/blake2.js";
import { blake3 } from "@noble/hashes/blake3.js";

const MAX_SIGNATURE_SCRIPT_BYTES = 250_000;
const SHARD_STATE_OFFSET = 1;
const SHARD_STATE_LENGTH = 117;
const PRIZE_STATE_OFFSET = 1;
const PRIZE_STATE_LENGTH = 51;

export const GIVEAWAY_V6_COMPILER_COMMIT = "3ed973335b59269293564805cc2c58a14595ec03";
export const GIVEAWAY_V6_SHARD_SOURCE_SHA256 =
  "13b29a1b966ea94a8142ec0158fe894907d41d0af785e17e752835007707183e";
export const GIVEAWAY_V6_PRIZE_SOURCE_SHA256 =
  "066488defedbffb7c90bf6f3836acfe06f1eb13cbbb888a4109b26d60e4a7eed";

export const GIVEAWAY_V6_SHARD_DISPATCH_TAGS = {
  delegateFreeze: "ca458417",
  register: "d6664b8d",
} as const;

export const GIVEAWAY_V6_PRIZE_DISPATCH_TAGS = {
  activate: "a2b5a377",
  draw: "419cd791",
  freeze: "97cde3a1",
  returnFunds: "2a331e3e",
} as const;

export type GiveawayV6WitnessErrorCode =
  | "INVALID_ARGUMENT"
  | "INVALID_HEX"
  | "INVALID_PUSH"
  | "INVALID_STATE"
  | "UNKNOWN_ENTRY";

export class GiveawayV6WitnessError extends Error {
  readonly code: GiveawayV6WitnessErrorCode;

  constructor(code: GiveawayV6WitnessErrorCode, message: string) {
    super(message);
    this.name = "GiveawayV6WitnessError";
    this.code = code;
  }
}

export type GiveawayV6ShardState = {
  shardIndex: number;
  count: number;
  entriesRootHex: string;
  addressRootHex: string;
  pendingHashHex: string;
};

export type GiveawayV6PrizeState = {
  phase: 0 | 1 | 2;
  frozenRootHex: string;
  entryCount: number;
};

type WitnessBase = {
  redeemScriptHex: string;
  redeemScriptSha256Hex: string;
  templateHashHex: string;
};

export type GiveawayV6RegisterWitness = WitnessBase & {
  contract: "shard";
  method: "register";
  state: GiveawayV6ShardState;
  payoutScriptPublicKeyHex: string;
  appendSiblingCount: number;
  addressSiblingCount: 256;
};

export type GiveawayV6DelegateFreezeWitness = WitnessBase & {
  contract: "shard";
  method: "delegateFreeze";
  state: GiveawayV6ShardState;
};

export type GiveawayV6ActivateWitness = WitnessBase & {
  contract: "prize";
  method: "activate";
  state: GiveawayV6PrizeState;
  shardPrefixHex: string;
  shardSuffixHex: string;
};

export type GiveawayV6FreezeWitness = WitnessBase & {
  contract: "prize";
  method: "freeze";
  state: GiveawayV6PrizeState;
  pendingSiblingCount: number;
};

export type GiveawayV6DrawWitness = WitnessBase & {
  contract: "prize";
  method: "draw";
  state: GiveawayV6PrizeState;
  proofSha256Hex: string;
  parentBlockHashHex: string;
  parentBlueScore: bigint;
  candidateBlockHashHex: string;
  candidateBlueScore: bigint;
  shardCounts: readonly number[];
  shardEntriesRootsHex: readonly string[];
  shardAddressRootsHex: readonly string[];
  winnerScriptPublicKeyHex: string;
  winnerSiblingCount: number;
};

export type GiveawayV6ReturnWitness = WitnessBase & {
  contract: "prize";
  method: "returnFunds";
  state: GiveawayV6PrizeState;
};

export type GiveawayV6DecodedWitness =
  | GiveawayV6RegisterWitness
  | GiveawayV6DelegateFreezeWitness
  | GiveawayV6ActivateWitness
  | GiveawayV6FreezeWitness
  | GiveawayV6DrawWitness
  | GiveawayV6ReturnWitness;

/** Rebuilds a Prize redeem script with an explicitly verified runtime state. */
export function buildGiveawayV6PrizeRedeemScriptHex(
  redeemScriptHex: string,
  state: GiveawayV6PrizeState,
): string {
  return replaceState(
    redeemScriptHex,
    PRIZE_STATE_OFFSET,
    PRIZE_STATE_LENGTH,
    encodePrizeState(state),
  );
}

/** Reads the compiler-defined mutable Prize state from a reviewed redeem script. */
export function readGiveawayV6PrizeState(redeemScriptHex: string): GiveawayV6PrizeState {
  return decodePrizeState(
    parseHex(redeemScriptHex, "Prize redeem script", MAX_SIGNATURE_SCRIPT_BYTES),
  );
}

/** Rebuilds a Shard redeem script with an explicitly verified runtime state. */
export function buildGiveawayV6ShardRedeemScriptHex(
  redeemScriptHex: string,
  state: GiveawayV6ShardState,
): string {
  return replaceState(
    redeemScriptHex,
    SHARD_STATE_OFFSET,
    SHARD_STATE_LENGTH,
    encodeShardState(state),
  );
}

/** Reads the compiler-defined mutable Shard state from a reviewed redeem script. */
export function readGiveawayV6ShardState(redeemScriptHex: string): GiveawayV6ShardState {
  return decodeShardState(
    parseHex(redeemScriptHex, "Shard redeem script", MAX_SIGNATURE_SCRIPT_BYTES),
  );
}

/** Builds the initial Shard redeem script from activation's committed template pieces. */
export function buildGiveawayV6InitialShardRedeemScriptHex(
  shardPrefixHex: string,
  state: GiveawayV6ShardState,
  shardSuffixHex: string,
): string {
  const prefix = parseHex(shardPrefixHex, "shard prefix", MAX_SIGNATURE_SCRIPT_BYTES);
  const suffix = parseHex(shardSuffixHex, "shard suffix", MAX_SIGNATURE_SCRIPT_BYTES);
  return toHex(concat(prefix, encodeShardState(state), suffix));
}

/** Kaspa version-0 P2SH script public key for a SilverScript redeem script. */
export function giveawayV6PayToScriptHashScriptPublicKeyHex(redeemScriptHex: string): string {
  const redeemScript = parseHex(redeemScriptHex, "redeem script", MAX_SIGNATURE_SCRIPT_BYTES);
  const scriptHash = blake2b(redeemScript, { dkLen: 32 });
  return `0000aa20${toHex(scriptHash)}87`;
}

/** Template identity with the mutable state span removed, as defined by SilverScript V6. */
export function giveawayV6TemplateHashHex(
  contract: "prize" | "shard",
  redeemScriptHex: string,
): string {
  const redeemScript = parseHex(redeemScriptHex, "redeem script", MAX_SIGNATURE_SCRIPT_BYTES);
  return contract === "prize"
    ? templateHash(redeemScript, PRIZE_STATE_OFFSET, PRIZE_STATE_LENGTH)
    : templateHash(redeemScript, SHARD_STATE_OFFSET, SHARD_STATE_LENGTH);
}

type StackItem = {
  payload: Uint8Array;
};

/** Decodes a canonical accepted V6 SilverScript signature script. */
export function decodeGiveawayV6Witness(signatureScriptHex: string): GiveawayV6DecodedWitness {
  const signatureScript = parseHex(
    signatureScriptHex,
    "signature script",
    MAX_SIGNATURE_SCRIPT_BYTES,
  );
  const stack = parseCanonicalPushOnlyScript(signatureScript);
  if (stack.length < 2)
    fail("INVALID_PUSH", "V6 signature script must contain a dispatch tag and redeem script.");
  const redeemScript = stack.at(-1)!.payload;
  const dispatchTag = stack.at(-2)!.payload;
  if (dispatchTag.length !== 4) fail("UNKNOWN_ENTRY", "V6 dispatch tag must contain four bytes.");
  if (redeemScript.length === 0) fail("INVALID_PUSH", "V6 redeem script must not be empty.");
  const args = stack.slice(0, -2).map((item) => item.payload);
  const tagHex = toHex(dispatchTag);
  const common = {
    redeemScriptHex: toHex(redeemScript),
    redeemScriptSha256Hex: toHex(sha256(redeemScript)),
  };

  if (tagHex === GIVEAWAY_V6_SHARD_DISPATCH_TAGS.register) {
    requireArgumentCount(args, 3, "register");
    const state = decodeShardState(redeemScript);
    const payoutScript = requireBytes(args[0]!, 2, 128, "registration payout script");
    const appendSiblingCount = requireHashArray(args[1]!, 1, 16, "append siblings").length;
    const addressSiblingCount = requireHashArray(args[2]!, 256, 256, "address siblings").length;
    return {
      ...common,
      templateHashHex: templateHash(redeemScript, SHARD_STATE_OFFSET, SHARD_STATE_LENGTH),
      contract: "shard",
      method: "register",
      state,
      payoutScriptPublicKeyHex: toHex(payoutScript),
      appendSiblingCount,
      addressSiblingCount: addressSiblingCount as 256,
    };
  }

  if (tagHex === GIVEAWAY_V6_SHARD_DISPATCH_TAGS.delegateFreeze) {
    requireArgumentCount(args, 0, "delegateFreeze");
    return {
      ...common,
      templateHashHex: templateHash(redeemScript, SHARD_STATE_OFFSET, SHARD_STATE_LENGTH),
      contract: "shard",
      method: "delegateFreeze",
      state: decodeShardState(redeemScript),
    };
  }

  if (tagHex === GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.activate) {
    requireArgumentCount(args, 2, "activate");
    return {
      ...common,
      templateHashHex: templateHash(redeemScript, PRIZE_STATE_OFFSET, PRIZE_STATE_LENGTH),
      contract: "prize",
      method: "activate",
      state: decodePrizeState(redeemScript),
      shardPrefixHex: toHex(args[0]!),
      shardSuffixHex: toHex(args[1]!),
    };
  }

  if (tagHex === GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.freeze) {
    requireArgumentCount(args, 1, "freeze");
    const pendingSiblingCount = requireHashArray(args[0]!, 1, 64, "pending siblings").length;
    return {
      ...common,
      templateHashHex: templateHash(redeemScript, PRIZE_STATE_OFFSET, PRIZE_STATE_LENGTH),
      contract: "prize",
      method: "freeze",
      state: decodePrizeState(redeemScript),
      pendingSiblingCount,
    };
  }

  if (tagHex === GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.draw) {
    requireArgumentCount(args, 10, "draw");
    const proof = requireBytes(args[0]!, 1, 250_000, "draw proof");
    const parentBlockHashHex = toHex(requireBytes(args[1]!, 32, 32, "parent block hash"));
    const parentBlueScore = decodePositiveScriptInt(args[2]!, "parent blue score");
    const candidateBlockHashHex = toHex(requireBytes(args[3]!, 32, 32, "candidate block hash"));
    const candidateBlueScore = decodePositiveScriptInt(args[4]!, "candidate blue score");
    const shardCounts = decodeFixedIntArray(args[5]!, 1, 4, "shard counts");
    const shardEntriesRootsHex = requireHashArray(args[6]!, 1, 4, "shard entry roots").map(toHex);
    const shardAddressRootsHex = requireHashArray(args[7]!, 1, 4, "shard address roots").map(toHex);
    if (
      shardCounts.length !== shardEntriesRootsHex.length ||
      shardCounts.length !== shardAddressRootsHex.length
    ) {
      fail("INVALID_ARGUMENT", "Draw shard counts and root vectors must have the same length.");
    }
    const winnerScript = requireBytes(args[8]!, 2, 128, "winner payout script");
    const winnerSiblingCount = requireHashArray(args[9]!, 1, 16, "winner siblings").length;
    return {
      ...common,
      templateHashHex: templateHash(redeemScript, PRIZE_STATE_OFFSET, PRIZE_STATE_LENGTH),
      contract: "prize",
      method: "draw",
      state: decodePrizeState(redeemScript),
      proofSha256Hex: toHex(sha256(proof)),
      parentBlockHashHex,
      parentBlueScore,
      candidateBlockHashHex,
      candidateBlueScore,
      shardCounts,
      shardEntriesRootsHex,
      shardAddressRootsHex,
      winnerScriptPublicKeyHex: toHex(winnerScript),
      winnerSiblingCount,
    };
  }

  if (tagHex === GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.returnFunds) {
    requireArgumentCount(args, 0, "returnFunds");
    return {
      ...common,
      templateHashHex: templateHash(redeemScript, PRIZE_STATE_OFFSET, PRIZE_STATE_LENGTH),
      contract: "prize",
      method: "returnFunds",
      state: decodePrizeState(redeemScript),
    };
  }

  fail("UNKNOWN_ENTRY", "Signature script does not use a known Giveaway V6 dispatch tag.");
}

function decodeShardState(redeemScript: Uint8Array): GiveawayV6ShardState {
  const values = parseStatePushes(redeemScript, SHARD_STATE_OFFSET, SHARD_STATE_LENGTH, 5);
  const shardIndex = toSafeNumber(
    decodePositiveFixedInt64(values[0]!, "shard index"),
    "shard index",
  );
  const count = toSafeNumber(decodePositiveFixedInt64(values[1]!, "shard count"), "shard count");
  if (shardIndex < 0 || shardIndex > 3)
    fail("INVALID_STATE", "Shard state index must be in the V6 range 0 through 3.");
  return {
    shardIndex,
    count,
    entriesRootHex: toHex(requireBytes(values[2]!, 32, 32, "entry root")),
    addressRootHex: toHex(requireBytes(values[3]!, 32, 32, "address root")),
    pendingHashHex: toHex(requireBytes(values[4]!, 32, 32, "pending hash")),
  };
}

function decodePrizeState(redeemScript: Uint8Array): GiveawayV6PrizeState {
  const values = parseStatePushes(redeemScript, PRIZE_STATE_OFFSET, PRIZE_STATE_LENGTH, 3);
  const phase = toSafeNumber(decodePositiveFixedInt64(values[0]!, "prize phase"), "prize phase");
  const entryCount = toSafeNumber(
    decodePositiveFixedInt64(values[2]!, "entry count"),
    "entry count",
  );
  if (phase !== 0 && phase !== 1 && phase !== 2)
    fail("INVALID_STATE", "Prize state phase must be 0, 1, or 2.");
  return {
    phase,
    frozenRootHex: toHex(requireBytes(values[1]!, 32, 32, "frozen root")),
    entryCount,
  };
}

function encodeShardState(state: GiveawayV6ShardState): Uint8Array {
  if (!Number.isSafeInteger(state.shardIndex) || state.shardIndex < 0 || state.shardIndex > 3) {
    fail("INVALID_STATE", "Shard state index must be in the V6 range 0 through 3.");
  }
  if (!Number.isSafeInteger(state.count) || state.count < 0) {
    fail("INVALID_STATE", "Shard state count must be a non-negative safe integer.");
  }
  return concat(
    encodeFixedInt64(BigInt(state.shardIndex), "shard index"),
    encodeFixedInt64(BigInt(state.count), "shard count"),
    encodeFixedHash(state.entriesRootHex, "entry root"),
    encodeFixedHash(state.addressRootHex, "address root"),
    encodeFixedHash(state.pendingHashHex, "pending hash"),
  );
}

function encodePrizeState(state: GiveawayV6PrizeState): Uint8Array {
  if (state.phase !== 0 && state.phase !== 1 && state.phase !== 2) {
    fail("INVALID_STATE", "Prize state phase must be 0, 1, or 2.");
  }
  if (!Number.isSafeInteger(state.entryCount) || state.entryCount < 0) {
    fail("INVALID_STATE", "Prize entry count must be a non-negative safe integer.");
  }
  return concat(
    encodeFixedInt64(BigInt(state.phase), "prize phase"),
    encodeFixedHash(state.frozenRootHex, "frozen root"),
    encodeFixedInt64(BigInt(state.entryCount), "entry count"),
  );
}

function encodeFixedInt64(value: bigint, label: string): Uint8Array {
  if (value < 0n || value > 0x7fff_ffff_ffff_ffffn) {
    fail("INVALID_STATE", `${label} exceeds the non-negative fixed-width int range.`);
  }
  return concat(Uint8Array.of(0x08), u64Le(value));
}

function encodeFixedHash(value: string, label: string): Uint8Array {
  const hash = parseHex(value, label, 32);
  if (hash.length !== 32) fail("INVALID_STATE", `${label} must contain exactly 32 bytes.`);
  return concat(Uint8Array.of(0x20), hash);
}

function replaceState(
  redeemScriptHex: string,
  offset: number,
  length: number,
  state: Uint8Array,
): string {
  const redeemScript = parseHex(redeemScriptHex, "redeem script", MAX_SIGNATURE_SCRIPT_BYTES);
  if (state.length !== length || redeemScript.length < offset + length) {
    fail("INVALID_STATE", "Redeem script is shorter than the V6 state span.");
  }
  return toHex(concat(redeemScript.slice(0, offset), state, redeemScript.slice(offset + length)));
}

function parseStatePushes(
  redeemScript: Uint8Array,
  offset: number,
  length: number,
  expectedPushes: number,
): Uint8Array[] {
  const end = offset + length;
  if (redeemScript.length < end)
    fail("INVALID_STATE", "Redeem script is shorter than the V6 state span.");
  const pushes = parseCanonicalPushOnlyScript(redeemScript.slice(offset, end));
  if (pushes.length !== expectedPushes)
    fail("INVALID_STATE", "Redeem script has an invalid V6 state encoding.");
  return pushes.map((value) => value.payload);
}

function templateHash(redeemScript: Uint8Array, stateOffset: number, stateLength: number): string {
  const stateEnd = stateOffset + stateLength;
  if (redeemScript.length < stateEnd)
    fail("INVALID_STATE", "Redeem script is shorter than the V6 template span.");
  const prefix = redeemScript.slice(0, stateOffset);
  const suffix = redeemScript.slice(stateEnd);
  const preimage = concat(
    u64Le(BigInt(prefix.length)),
    prefix,
    u64Le(BigInt(suffix.length)),
    suffix,
  );
  return toHex(blake3(preimage));
}

function parseCanonicalPushOnlyScript(script: Uint8Array): StackItem[] {
  const pushes: StackItem[] = [];
  let offset = 0;
  while (offset < script.length) {
    const opcode = script[offset]!;
    offset += 1;
    if (opcode === 0x00) {
      pushes.push({ payload: new Uint8Array() });
      continue;
    }
    if (opcode === 0x4f) {
      pushes.push({ payload: Uint8Array.of(0x81) });
      continue;
    }
    if (opcode >= 0x51 && opcode <= 0x60) {
      pushes.push({ payload: Uint8Array.of(opcode - 0x50) });
      continue;
    }

    let length: number;
    if (opcode >= 0x01 && opcode <= 0x4b) {
      length = opcode;
    } else if (opcode === 0x4c) {
      length = readLength(script, offset, 1);
      offset += 1;
      if (length < 0x4c)
        fail("INVALID_PUSH", "Signature script contains a non-canonical PUSHDATA1.");
    } else if (opcode === 0x4d) {
      length = readLength(script, offset, 2);
      offset += 2;
      if (length <= 0xff)
        fail("INVALID_PUSH", "Signature script contains a non-canonical PUSHDATA2.");
    } else if (opcode === 0x4e) {
      length = readLength(script, offset, 4);
      offset += 4;
      if (length <= 0xffff)
        fail("INVALID_PUSH", "Signature script contains a non-canonical PUSHDATA4.");
    } else {
      fail("INVALID_PUSH", "Signature script contains a non-push opcode.");
    }
    if (offset + length > script.length)
      fail("INVALID_PUSH", "Signature script contains a truncated data push.");
    const payload = script.slice(offset, offset + length);
    offset += length;
    if (length === 1 && (payload[0] === 0x81 || (payload[0]! >= 1 && payload[0]! <= 16))) {
      fail("INVALID_PUSH", "Signature script contains a non-canonical one-byte data push.");
    }
    pushes.push({ payload });
  }
  return pushes;
}

function readLength(script: Uint8Array, offset: number, byteLength: number): number {
  if (offset + byteLength > script.length)
    fail("INVALID_PUSH", "Signature script ends inside a push length.");
  let value = 0;
  for (let index = 0; index < byteLength; index += 1)
    value += script[offset + index]! * 2 ** (8 * index);
  if (!Number.isSafeInteger(value))
    fail("INVALID_PUSH", "Signature script push length is too large.");
  return value;
}

function decodePositiveScriptInt(payload: Uint8Array, label: string): bigint {
  if (payload.length > 8) fail("INVALID_ARGUMENT", `${label} does not fit a SilverScript int.`);
  if (payload.length === 0) return 0n;
  const last = payload.at(-1)!;
  if ((last & 0x80) !== 0) fail("INVALID_ARGUMENT", `${label} must not be negative.`);
  if ((last & 0x7f) === 0 && (payload.length === 1 || (payload.at(-2)! & 0x80) === 0)) {
    fail("INVALID_ARGUMENT", `${label} is not minimally encoded.`);
  }
  return littleEndianBigInt(payload);
}

function decodePositiveFixedInt64(payload: Uint8Array, label: string): bigint {
  if (payload.length !== 8 || (payload[7]! & 0x80) !== 0) {
    fail("INVALID_STATE", `${label} must be a non-negative fixed-width SilverScript int.`);
  }
  return littleEndianBigInt(payload);
}

function decodeFixedIntArray(
  payload: Uint8Array,
  minimum: number,
  maximum: number,
  label: string,
): number[] {
  if (payload.length % 8 !== 0)
    fail("INVALID_ARGUMENT", `${label} must contain fixed-width SilverScript ints.`);
  const length = payload.length / 8;
  if (length < minimum || length > maximum)
    fail("INVALID_ARGUMENT", `${label} has an invalid element count.`);
  const values: number[] = [];
  for (let index = 0; index < payload.length; index += 8) {
    values.push(
      toSafeNumber(decodePositiveFixedInt64(payload.slice(index, index + 8), label), label),
    );
  }
  return values;
}

function requireHashArray(
  payload: Uint8Array,
  minimum: number,
  maximum: number,
  label: string,
): Uint8Array[] {
  if (payload.length % 32 !== 0) fail("INVALID_ARGUMENT", `${label} must contain 32-byte hashes.`);
  const length = payload.length / 32;
  if (length < minimum || length > maximum)
    fail("INVALID_ARGUMENT", `${label} has an invalid element count.`);
  const values: Uint8Array[] = [];
  for (let index = 0; index < payload.length; index += 32)
    values.push(payload.slice(index, index + 32));
  return values;
}

function requireBytes(
  payload: Uint8Array,
  minimumLength: number,
  maximumLength: number,
  label: string,
): Uint8Array {
  if (payload.length < minimumLength || payload.length > maximumLength) {
    fail("INVALID_ARGUMENT", `${label} has an invalid byte length.`);
  }
  return payload;
}

function requireArgumentCount(args: readonly Uint8Array[], expected: number, method: string): void {
  if (args.length !== expected)
    fail("INVALID_ARGUMENT", `${method} witness has an invalid argument count.`);
}

function littleEndianBigInt(payload: Uint8Array): bigint {
  let value = 0n;
  for (let index = payload.length - 1; index >= 0; index -= 1)
    value = (value << 8n) | BigInt(payload[index]!);
  return value;
}

function toSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    fail("INVALID_ARGUMENT", `${label} exceeds the safe integer range.`);
  return Number(value);
}

function u64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function sha256(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function parseHex(value: string, label: string, maximumBytes: number): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/u.test(value)
  ) {
    fail("INVALID_HEX", `${label} must be non-empty even-length hex.`);
  }
  if (value.length / 2 > maximumBytes)
    fail("INVALID_HEX", `${label} exceeds the supported byte length.`);
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function toHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function fail(code: GiveawayV6WitnessErrorCode, message: string): never {
  throw new GiveawayV6WitnessError(code, message);
}
