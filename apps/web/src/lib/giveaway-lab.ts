import { createHash, randomBytes } from "node:crypto";

import {
  formatSompiToKaspa,
  parseKaspaAmountToSompi,
  validateKaspaAddress,
} from "@kaspa-actions/kaspa";
import { z } from "zod";

import { assertReliableMainnetOutputAmount } from "./mainnet-amount-policy";

const GIVEAWAY_DRAW_DOMAIN = "kaspa-links-giveaway-draw-v1";
const GIVEAWAY_SEED_DOMAIN = "kaspa-links-giveaway-seed-v1";
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
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
  title: z.string().trim().min(1).max(80),
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

export function isGiveawayLabEnabled(): boolean {
  return process.env.TOCCATA_LAB_ENABLED === "true" && process.env.GIVEAWAY_LAB_ENABLED === "true";
}

export function parseGiveawayTerms(
  input: z.infer<typeof createGiveawayInputSchema>,
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
    title: input.title.trim(),
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
  return sha256Hex(`kaspa-links-giveaway-entry-v1\n${address}`);
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

export function effectiveGiveawayStatus(status: string, closesAt: Date, now = new Date()): string {
  return status === "OPEN" && closesAt.getTime() <= now.getTime() ? "CLOSED" : status;
}

function hashSeed(seedHex: string): string {
  return sha256Hex(`${GIVEAWAY_SEED_DOMAIN}\n${seedHex}`);
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeOptionalText(value: null | string | undefined): null | string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
