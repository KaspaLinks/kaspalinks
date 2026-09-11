import { createHash } from "node:crypto";

/**
 * Draw proof format for the covenant-enforced prize (protocol v3).
 *
 * Every value here is reproduced inside `labs/claimable-script/giveaway_prize_v3.sil`,
 * so the encodings are chosen for what a Kaspa script can do cheaply:
 *
 * - Hashes are taken over raw bytes, not over ASCII text of hex the way v2
 *   does (`giveaway-proof-shared.ts`). Reproducing v2's encoding on-chain
 *   would mean hex-encoding inside the script.
 * - The entry list is committed flat: `entriesRoot = sha256(concat(entryHashes))`.
 *   An earlier draft used a Merkle tree, but the script cost turned out to be
 *   ~89 bytes per level once the path direction is bound to the winner index,
 *   against 130 bytes total for the flat form at any entrant count. The full
 *   list travels in the draw transaction's witness instead.
 * - The winner index reads four digest bytes as an unsigned little-endian
 *   integer. The script does the same via `OpBin2Num` over those bytes plus a
 *   0x00 high byte, which keeps the script integer non-negative.
 *
 * Entries commit to the winner's script public key, not to an address, so the
 * covenant can compare directly against `tx.outputs[0].scriptPubKey`.
 */

/** Domain tag for the open-state commitment. */
export const GIVEAWAY_V3_TAG_OPEN = 0x00;
/** Domain tag for the frozen-state commitment. */
export const GIVEAWAY_V3_TAG_FROZEN = 0x01;
/** Domain tag for the draw digest. */
export const GIVEAWAY_V3_TAG_DIGEST = 0x03;
/** Domain tag for the entry-list attestation. */
export const GIVEAWAY_V3_TAG_ENTRIES_ATTESTATION = 0x11;
/** Domain tag for the entropy-block attestation. */
export const GIVEAWAY_V3_TAG_ENTROPY_ATTESTATION = 0x12;

/**
 * Entrant cap. Not a protocol limit — the flat list costs 32 witness bytes per
 * entrant, but transaction mass, compute budget and fees must be checked separately.
 */
export const GIVEAWAY_V3_MAX_ENTRIES = 4096;

const HEX32 = /^[0-9a-f]{64}$/;

function sha256(...parts: Buffer[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function tag(value: number): Buffer {
  return Buffer.from([value]);
}

function requireHex32(value: string, label: string): Buffer {
  const normalized = value.trim().toLowerCase();
  if (!HEX32.test(normalized)) throw new Error(`${label} must be 32-byte hex.`);
  return Buffer.from(normalized, "hex");
}

function requireHex(value: string, label: string): Buffer {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error(`${label} must be hex.`);
  }
  return Buffer.from(normalized, "hex");
}

/**
 * One entrant, committed by their payout script public key. The script public
 * key is the serialized form including its two-byte version prefix, which is
 * what `tx.outputs[i].scriptPubKey` returns on-chain.
 */
export function giveawayV3EntryHash(scriptPublicKeyHex: string): string {
  return sha256(requireHex(scriptPublicKeyHex, "Script public key")).toString("hex");
}

/**
 * Canonical entrant order: ascending by entry hash. Independent of the order
 * entries arrived in, so the list is reproducible from the published proof.
 */
export function giveawayV3SortEntryHashes(entryHashes: readonly string[]): string[] {
  return [...entryHashes]
    .map((value, index) => requireHex32(value, `Entry hash ${index}`).toString("hex"))
    .sort();
}

/** The flat entry blob exactly as it travels in the draw witness. */
export function giveawayV3EntriesBlob(sortedEntryHashes: readonly string[]): Buffer {
  if (sortedEntryHashes.length === 0) throw new Error("A draw needs at least one entry.");
  if (sortedEntryHashes.length > GIVEAWAY_V3_MAX_ENTRIES) {
    throw new Error(`A draw supports at most ${GIVEAWAY_V3_MAX_ENTRIES} entries.`);
  }
  return Buffer.concat(
    sortedEntryHashes.map((value, index) => requireHex32(value, `Entry hash ${index}`)),
  );
}

/** `entriesRoot = sha256(entryHash_0 ‖ … ‖ entryHash_n-1)`. */
export function giveawayV3EntriesRoot(sortedEntryHashes: readonly string[]): string {
  return sha256(giveawayV3EntriesBlob(sortedEntryHashes)).toString("hex");
}

/** `digest = sha256(0x03 ‖ seed ‖ entriesRoot)`. */
export function giveawayV3Digest(params: { seedHex: string; entriesRootHex: string }): string {
  return sha256(
    tag(GIVEAWAY_V3_TAG_DIGEST),
    requireHex32(params.seedHex, "Seed"),
    requireHex32(params.entriesRootHex, "Entries root"),
  ).toString("hex");
}

/**
 * `winnerIndex = uint32LE(digest[0..4]) mod entryCount`.
 *
 * The script computes the same value as
 * `OpBin2Num(digest[0..4] ‖ 0x00) % entryCount`.
 */
export function giveawayV3WinnerIndex(digestHex: string, entryCount: number): number {
  if (!Number.isInteger(entryCount) || entryCount <= 0) {
    throw new Error("Entry count must be a positive integer.");
  }
  const digest = requireHex32(digestHex, "Digest");
  return digest.readUInt32LE(0) % entryCount;
}

/**
 * Eight little-endian bytes with the sign bit clear, which is how the script
 * reads a parameter through `OpBin2Num`.
 */
function u64le(value: bigint, label: string): Buffer {
  if (value < 0n || value >= 1n << 55n) throw new Error(`${label} is out of range.`);
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

/**
 * `paramsHash = sha256(prize ‖ drawFee ‖ closesAt ‖ refundAt ‖ creatorPk)`.
 *
 * Every branch rebuilds this from the witness and checks it against the state,
 * which is what lets one compiled artifact serve every giveaway.
 */
export function giveawayV3ParamsHash(params: {
  prizeSompi: bigint;
  drawFeeSompi: bigint;
  closesAtDaa: bigint;
  refundDaa: bigint;
  creatorPublicKeyHex: string;
}): string {
  if (params.prizeSompi <= 0n || params.drawFeeSompi <= 0n) {
    throw new Error("Prize and draw fee must be positive.");
  }
  if (params.closesAtDaa <= 0n || params.refundDaa <= params.closesAtDaa) {
    throw new Error("Refund must follow the positive entry-close DAA score.");
  }
  return sha256(
    u64le(params.prizeSompi, "Prize"),
    u64le(params.drawFeeSompi, "Draw fee"),
    u64le(params.closesAtDaa, "Entry close DAA score"),
    u64le(params.refundDaa, "Refund DAA score"),
    requireHex32(params.creatorPublicKeyHex, "Creator public key"),
  ).toString("hex");
}

/** State before the entry list is frozen. The entry root is still all zeroes. */
export function giveawayV3OpenStateHash(paramsHashHex: string): string {
  return sha256(
    tag(GIVEAWAY_V3_TAG_OPEN),
    requireHex32(paramsHashHex, "Params hash"),
    Buffer.alloc(32),
  ).toString("hex");
}

/** State once the entry list is frozen. Both states share a shape of equal length. */
export function giveawayV3FrozenStateHash(paramsHashHex: string, entriesRootHex: string): string {
  return sha256(
    tag(GIVEAWAY_V3_TAG_FROZEN),
    requireHex32(paramsHashHex, "Params hash"),
    requireHex32(entriesRootHex, "Entries root"),
  ).toString("hex");
}

/**
 * Digest the platform signs to attest the entry list for one giveaway.
 * `paramsHash` binds the signature to these parameters. A fresh creator
 * recovery key is required per giveaway: identical parameters produce the same
 * covenant and allow attestations to be reused. The leading tag separates it from the entropy attestation, which
 * otherwise hashes the same shape.
 */
export function giveawayV3EntriesAttestationDigest(params: {
  paramsHashHex: string;
  entriesRootHex: string;
}): string {
  return sha256(
    tag(GIVEAWAY_V3_TAG_ENTRIES_ATTESTATION),
    requireHex32(params.paramsHashHex, "Params hash"),
    requireHex32(params.entriesRootHex, "Entries root"),
  ).toString("hex");
}

/**
 * Digest the platform signs to attest the entropy block.
 *
 * The script verifies the block is in the selected chain, but cannot read its
 * blue score, so without this attestation any submitter could pick among every
 * selected-chain block inside the finality window and grind themselves a win.
 * The target height is published ahead of the draw, which makes a deviation
 * provable by anyone even though it is not preventable on-chain.
 */
export function giveawayV3EntropyAttestationDigest(params: {
  paramsHashHex: string;
  blockHashHex: string;
}): string {
  return sha256(
    tag(GIVEAWAY_V3_TAG_ENTROPY_ATTESTATION),
    requireHex32(params.paramsHashHex, "Params hash"),
    requireHex32(params.blockHashHex, "Block hash"),
  ).toString("hex");
}

/** Resolve a complete draw from the published inputs. */
export function giveawayV3Draw(params: { seedHex: string; sortedEntryHashes: readonly string[] }): {
  entriesRootHex: string;
  digestHex: string;
  winnerIndex: number;
  winnerEntryHashHex: string;
} {
  const entriesRootHex = giveawayV3EntriesRoot(params.sortedEntryHashes);
  const digestHex = giveawayV3Digest({ seedHex: params.seedHex, entriesRootHex });
  const winnerIndex = giveawayV3WinnerIndex(digestHex, params.sortedEntryHashes.length);
  const winner = params.sortedEntryHashes[winnerIndex];
  if (winner === undefined) throw new Error("Winner is missing from the committed entry list.");
  return {
    entriesRootHex,
    digestHex,
    winnerIndex,
    winnerEntryHashHex: requireHex32(winner, "Winner entry hash").toString("hex"),
  };
}
