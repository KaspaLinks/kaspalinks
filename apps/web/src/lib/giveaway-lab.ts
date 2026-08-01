import { createHash, randomBytes } from "node:crypto";

import {
  formatSompiToKaspa,
  parseKaspaAmountToSompi,
  validateKaspaAddress,
} from "@kaspa-actions/kaspa";
import { z } from "zod";

import { assertReliableMainnetOutputAmount } from "./mainnet-amount-policy";
import {
  GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS,
  GIVEAWAY_MAX_WINNER_CLAIM_SECONDS,
  GIVEAWAY_MIN_WINNER_CLAIM_SECONDS,
} from "./giveaway-prize-shared";
import {
  giveawayDrawV2Preimage,
  giveawayEntryPreimage,
  giveawayFreezePreimage,
  giveawayMerkleEmptyPreimage,
  giveawayMerkleLeafPreimage,
  giveawayMerkleNodePreimage,
  giveawaySeedPreimage,
} from "./giveaway-proof-shared";

const GIVEAWAY_DRAW_DOMAIN = "kaspa-links-giveaway-draw-v1";
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
export const GIVEAWAY_DRAW_PROTOCOL_VERSION = 2;
export const GIVEAWAY_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
export const GIVEAWAY_MIN_DURATION_MS = 30 * 1_000;

export const giveawayPublicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "Giveaway id is invalid.");

export const createGiveawayInputSchema = z.object({
  amountKas: z.string().min(1).max(40),
  closesAt: z.string().datetime({ offset: true }),
  description: z.string().trim().max(280).optional().nullable(),
  // Optional escrow: the linkKey of a claimable link the creator already
  // registered for this prize. Only a reference — no key material.
  prizeLinkKey: z.string().trim().min(1).max(128).optional().nullable(),
  title: z.string().trim().min(1).max(80),
  winnerClaimWindowSeconds: z
    .number()
    .int()
    .min(GIVEAWAY_MIN_WINNER_CLAIM_SECONDS)
    .max(GIVEAWAY_MAX_WINNER_CLAIM_SECONDS)
    .default(GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS),
});

export const enterGiveawayInputSchema = z.object({
  address: z.string().trim().min(1).max(200),
  turnstileToken: z.string().trim().min(1).max(2048).optional(),
});

export type GiveawayDrawEntry = {
  address: string;
  id: string;
};

export type GiveawayDrawResult = {
  digest: string;
  entryHashes: string[];
  winnerAddress: string;
  winnerEntryId: string;
  winnerIndex: number;
};

export type GiveawayFreezeResult = {
  entriesRoot: string;
  entryHashes: string[];
};

export type GiveawayDrawV2Result = GiveawayDrawResult & {
  entriesRoot: string;
  freezeCommitment: string;
};

export function isGiveawayLabEnabled(): boolean {
  return process.env.TOCCATA_LAB_ENABLED === "true" && process.env.GIVEAWAY_LAB_ENABLED === "true";
}

export function parseGiveawayTerms(
  input: z.input<typeof createGiveawayInputSchema>,
  now = new Date(),
) {
  const amountSompi = parseKaspaAmountToSompi(input.amountKas);
  assertReliableMainnetOutputAmount(amountSompi, "Giveaway reward");
  if (amountSompi > MAX_POSTGRES_BIGINT) {
    throw new Error("Giveaway reward exceeds the supported amount.");
  }

  const closesAt = new Date(input.closesAt);
  const durationMs = closesAt.getTime() - now.getTime();
  if (durationMs < GIVEAWAY_MIN_DURATION_MS) {
    throw new Error("Giveaway must remain open for at least 30 seconds.");
  }
  if (durationMs > GIVEAWAY_MAX_DURATION_MS) {
    throw new Error("Giveaway cannot remain open for more than 7 days.");
  }

  return {
    amountKas: formatSompiToKaspa(amountSompi),
    amountSompi,
    closesAt,
    description: normalizeOptionalText(input.description),
    entryWindowSeconds: Math.ceil(durationMs / 1_000),
    title: input.title.trim(),
    winnerClaimWindowSeconds:
      input.winnerClaimWindowSeconds ?? GIVEAWAY_DEFAULT_WINNER_CLAIM_SECONDS,
  };
}

export function normalizeGiveawayAddress(address: string): string {
  const validation = validateKaspaAddress(address.trim());
  if (!validation.valid) {
    throw new Error(validation.reason);
  }
  if (validation.network !== "mainnet") {
    throw new Error("Giveaway entries require a mainnet kaspa: address.");
  }
  return validation.address;
}

export function createGiveawayDrawSeed(): { commitment: string; seedHex: string } {
  const seedHex = randomBytes(32).toString("hex");
  return { commitment: hashSeed(seedHex), seedHex };
}

export function hashGiveawayEntryAddress(address: string): string {
  return sha256Hex(giveawayEntryPreimage(address));
}

export function computeGiveawayDraw(input: {
  closesAt: Date;
  entries: GiveawayDrawEntry[];
  publicId: string;
  seedHex: string;
}): GiveawayDrawResult {
  if (!/^[0-9a-f]{64}$/.test(input.seedHex)) {
    throw new Error("Giveaway draw seed is invalid.");
  }
  if (input.entries.length === 0) {
    throw new Error("Giveaway draw requires at least one entry.");
  }

  const ordered = input.entries
    .map((entry) => ({ ...entry, entryHash: hashGiveawayEntryAddress(entry.address) }))
    .sort((left, right) =>
      left.entryHash === right.entryHash
        ? left.id.localeCompare(right.id)
        : left.entryHash.localeCompare(right.entryHash),
    );
  const entryHashes = ordered.map((entry) => entry.entryHash);
  const digest = sha256Hex(
    [
      GIVEAWAY_DRAW_DOMAIN,
      input.seedHex,
      input.publicId,
      input.closesAt.toISOString(),
      ...entryHashes,
    ].join("\n"),
  );
  const winnerIndex = Number(BigInt(`0x${digest}`) % BigInt(ordered.length));
  const winner = ordered[winnerIndex]!;

  return {
    digest,
    entryHashes,
    winnerAddress: winner.address,
    winnerEntryId: winner.id,
    winnerIndex,
  };
}

export function freezeGiveawayEntries(entries: GiveawayDrawEntry[]): GiveawayFreezeResult {
  const entryHashes = entries
    .map((entry) => hashGiveawayEntryAddress(entry.address))
    .sort((left, right) => left.localeCompare(right));

  return {
    entriesRoot: computeGiveawayEntriesRoot(entryHashes),
    entryHashes,
  };
}

export function computeGiveawayEntriesRoot(entryHashes: string[]): string {
  if (entryHashes.length === 0) return sha256Hex(giveawayMerkleEmptyPreimage());
  if (
    entryHashes.some((entryHash) => !/^[0-9a-f]{64}$/.test(entryHash)) ||
    entryHashes.some((entryHash, index) => index > 0 && entryHashes[index - 1]! > entryHash)
  ) {
    throw new Error("Giveaway entry hash manifest is invalid.");
  }

  let level = entryHashes.map((entryHash) => sha256Hex(giveawayMerkleLeafPreimage(entryHash)));
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(sha256Hex(giveawayMerkleNodePreimage(left, right)));
    }
    level = next;
  }
  return level[0]!;
}

export function computeGiveawayFreezeCommitment(input: {
  closesAt: Date;
  drawCommitment: string;
  entriesRoot: string;
  entryCount: number;
  entropyTargetBlueScore: bigint;
  publicId: string;
}): string {
  return sha256Hex(
    giveawayFreezePreimage({
      closesAt: input.closesAt.toISOString(),
      drawCommitment: input.drawCommitment,
      entriesRoot: input.entriesRoot,
      entryCount: input.entryCount,
      entropyTargetBlueScore: input.entropyTargetBlueScore.toString(),
      publicId: input.publicId,
    }),
  );
}

export function computeGiveawayDrawV2(input: {
  closesAt: Date;
  drawCommitment: string;
  entries: GiveawayDrawEntry[];
  entriesRoot: string;
  entropyBlockBlueScore: bigint;
  entropyBlockHash: string;
  entropyTargetBlueScore: bigint;
  publicId: string;
  seedHex: string;
}): GiveawayDrawV2Result {
  if (!/^[0-9a-f]{64}$/.test(input.seedHex)) {
    throw new Error("Giveaway draw seed is invalid.");
  }
  if (!verifyGiveawaySeed(input.seedHex, input.drawCommitment)) {
    throw new Error("Giveaway draw seed does not match its precommitted value.");
  }
  if (!/^[0-9a-f]{64}$/.test(input.entropyBlockHash)) {
    throw new Error("Giveaway entropy block hash is invalid.");
  }
  if (input.entries.length === 0) {
    throw new Error("Giveaway draw requires at least one entry.");
  }

  const ordered = input.entries
    .map((entry) => ({ ...entry, entryHash: hashGiveawayEntryAddress(entry.address) }))
    .sort((left, right) => left.entryHash.localeCompare(right.entryHash));
  const entryHashes = ordered.map((entry) => entry.entryHash);
  const entriesRoot = computeGiveawayEntriesRoot(entryHashes);
  if (entriesRoot !== input.entriesRoot) {
    throw new Error("Giveaway entries no longer match the frozen participant root.");
  }

  const freezeCommitment = computeGiveawayFreezeCommitment({
    closesAt: input.closesAt,
    drawCommitment: input.drawCommitment,
    entriesRoot,
    entryCount: entryHashes.length,
    entropyTargetBlueScore: input.entropyTargetBlueScore,
    publicId: input.publicId,
  });
  const digest = sha256Hex(
    giveawayDrawV2Preimage({
      closesAt: input.closesAt.toISOString(),
      drawCommitment: input.drawCommitment,
      entriesRoot,
      entryCount: entryHashes.length,
      entropyBlockBlueScore: input.entropyBlockBlueScore.toString(),
      entropyBlockHash: input.entropyBlockHash,
      entropyTargetBlueScore: input.entropyTargetBlueScore.toString(),
      freezeCommitment,
      publicId: input.publicId,
      seedHex: input.seedHex,
    }),
  );
  const winnerIndex = Number(BigInt(`0x${digest}`) % BigInt(ordered.length));
  const winner = ordered[winnerIndex]!;

  return {
    digest,
    entriesRoot,
    entryHashes,
    freezeCommitment,
    winnerAddress: winner.address,
    winnerEntryId: winner.id,
    winnerIndex,
  };
}

export function computeEmptyGiveawayDrawDigest(input: {
  closesAt: Date;
  publicId: string;
  seedHex: string;
}): string {
  return sha256Hex(
    [GIVEAWAY_DRAW_DOMAIN, input.seedHex, input.publicId, input.closesAt.toISOString()].join("\n"),
  );
}

export function verifyGiveawaySeed(seedHex: string, commitment: string): boolean {
  return hashSeed(seedHex) === commitment;
}

export function effectiveGiveawayStatus(
  status: string,
  closesAt: Date,
  now = new Date(),
  openedAt?: Date | null,
): string {
  if (status === "OPEN" && openedAt === null) return "PENDING_FUNDING";
  return status === "OPEN" && closesAt.getTime() <= now.getTime() ? "CLOSED" : status;
}

function hashSeed(seedHex: string): string {
  return sha256Hex(giveawaySeedPreimage(seedHex));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeOptionalText(value: null | string | undefined): null | string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
