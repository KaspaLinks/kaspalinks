import { randomBytes } from "node:crypto";

import {
  buildKaspaAddressScriptPublicKeyHex,
  formatSompiToKaspa,
  parseKaspaAmountToSompi,
} from "@kaspa-actions/kaspa";
import type { GiveawayV6ReconstructionConfig } from "@kaspa-actions/kaspa-indexer";
import { z } from "zod";

import type { GiveawayV6CompilerEconomics } from "./giveaway-v6-compiler";
import {
  buildGiveawayV6Budget,
  GIVEAWAY_V6_MAX_ENTRIES_PER_SHARD,
  GIVEAWAY_V6_PARTICIPANT_CAPS,
} from "./giveaway-v6-budget";

export const GIVEAWAY_V6_TREE_DEPTH = 10;
export const GIVEAWAY_V6_MIN_DURATION_SECONDS = 30;
export const GIVEAWAY_V6_MAX_DURATION_SECONDS = 24 * 60 * 60;
export const GIVEAWAY_V6_RETURN_DELAY_SECONDS = 24 * 60 * 60;
export const GIVEAWAY_V6_ENTROPY_DELAY_SECONDS = 60;

const DAA_PER_SECOND = 10n;
const SUPPORTED_PRIZES_KAS = ["0.2", "0.5", "1"] as const;

export const createGiveawayV6InputSchema = z
  .object({
    amountKas: z.enum(SUPPORTED_PRIZES_KAS),
    description: z.string().trim().max(280).optional().nullable(),
    durationSeconds: z
      .number()
      .int()
      .min(GIVEAWAY_V6_MIN_DURATION_SECONDS)
      .max(GIVEAWAY_V6_MAX_DURATION_SECONDS),
    participantCap: z.union([
      z.literal(GIVEAWAY_V6_PARTICIPANT_CAPS[0]),
      z.literal(GIVEAWAY_V6_PARTICIPANT_CAPS[1]),
      z.literal(GIVEAWAY_V6_PARTICIPANT_CAPS[2]),
    ]),
    returnAddress: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(80),
  })
  .strict();

export type CreateGiveawayV6Input = z.infer<typeof createGiveawayV6InputSchema>;

export function isGiveawayV6CreationEnabled(): boolean {
  return (
    process.env.TOCCATA_LAB_ENABLED === "true" &&
    process.env.GIVEAWAY_LAB_ENABLED === "true" &&
    process.env.GIVEAWAY_V6_CREATION_ENABLED === "true"
  );
}

export function buildGiveawayV6CreationTerms(input: {
  chain: { blueScore: bigint; daa: bigint };
  request: CreateGiveawayV6Input;
  giveawayIdHex?: string;
}) {
  const prizeValueSompi = parseKaspaAmountToSompi(input.request.amountKas);
  const budget = buildGiveawayV6Budget(prizeValueSompi, input.request.participantCap);
  const durationDaa = BigInt(input.request.durationSeconds) * DAA_PER_SECOND;
  const closesAtDaa = input.chain.daa + durationDaa;
  const entropyTargetBlueScore =
    input.chain.blueScore +
    durationDaa +
    BigInt(GIVEAWAY_V6_ENTROPY_DELAY_SECONDS) * DAA_PER_SECOND;
  const returnAtDaa = closesAtDaa + BigInt(GIVEAWAY_V6_RETURN_DELAY_SECONDS) * DAA_PER_SECOND;
  const returnScriptPublicKeyHex = buildKaspaAddressScriptPublicKeyHex(input.request.returnAddress);
  const giveawayIdHex = (input.giveawayIdHex ?? randomBytes(32).toString("hex")).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(giveawayIdHex)) {
    throw new Error("Giveaway V6 ID must be 32-byte hexadecimal.");
  }

  const config: GiveawayV6ReconstructionConfig = {
    giveawayIdHex,
    closesAtDaa,
    returnAtDaa,
    entropyTargetBlueScore,
    shardCount: budget.shardCount,
    treeDepth: GIVEAWAY_V6_TREE_DEPTH,
    maxEntriesPerShard: GIVEAWAY_V6_MAX_ENTRIES_PER_SHARD,
    returnScriptPublicKeyHex,
  };
  const economics: GiveawayV6CompilerEconomics = {
    prizeValueSompi,
    shardValueSompi: budget.shardValueSompi,
    entryFeeSompi: budget.entryFeeSompi,
    activationFeeSompi: budget.activationFeeSompi,
    freezeFeeSompi: budget.freezeFeeSompi,
    drawFeeSompi: budget.drawFeeSompi,
    returnFeeSompi: budget.returnFeeSompi,
  };

  return {
    amountKas: formatSompiToKaspa(prizeValueSompi),
    config,
    description: normalizeOptionalText(input.request.description),
    economics,
    executionReserveSompi: budget.executionReserveSompi,
    expectedFundingSompi: budget.expectedFundingSompi,
    maximumEntryFeesSompi: budget.maximumEntryFeesSompi,
    maximumNetworkCostSompi: budget.maximumNetworkCostSompi,
    minimumReturnSompi: budget.minimumReturnSompi,
    participantCap: budget.participantCap,
    settlementFeesSompi: budget.settlementFeesSompi,
    title: input.request.title.trim(),
  };
}

function normalizeOptionalText(value: null | string | undefined): null | string {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
