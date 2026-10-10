import { z } from "zod";

import {
  GiveawayV6ChainEvent,
  GiveawayV6ReconstructionConfig,
  GiveawayV6ReconstructionError,
  GiveawayV6ReconstructionSnapshot,
  reconstructGiveawayV6,
} from "./giveaway-v6-reconstructor";

export type GiveawayV6ConfigJson = {
  giveawayIdHex: string;
  closesAtDaa: string;
  returnAtDaa: string;
  entropyTargetBlueScore: string;
  shardCount: number;
  treeDepth: number;
  maxEntriesPerShard: number;
  returnScriptPublicKeyHex: string;
};

const MAX_U64 = (1n << 64n) - 1n;

const hashHexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/u)
  .transform((value) => value.toLowerCase());

const scriptHexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]+$/u)
  .refine((value) => value.length % 2 === 0 && value.length >= 4 && value.length <= 256)
  .transform((value) => value.toLowerCase());

const u64DecimalSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u)
  .transform((value, context) => {
    const parsed = BigInt(value);
    if (parsed > MAX_U64) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Value exceeds uint64." });
      return z.NEVER;
    }
    return parsed;
  });

const outputIndexSchema = z.number().int().min(0).max(0xffffffff);
const countSchema = z.number().int().min(0).max(262_144);

const outpointSchema = z
  .object({
    transactionId: hashHexSchema,
    outputIndex: outputIndexSchema,
  })
  .strict();

const configSchema = z
  .object({
    giveawayIdHex: hashHexSchema,
    closesAtDaa: u64DecimalSchema,
    returnAtDaa: u64DecimalSchema,
    entropyTargetBlueScore: u64DecimalSchema,
    shardCount: z.number().int().min(1).max(4),
    treeDepth: z.number().int().min(1).max(16),
    maxEntriesPerShard: z.number().int().min(1).max(65_536),
    returnScriptPublicKeyHex: scriptHexSchema,
  })
  .strict();

const transitionBase = {
  transactionId: hashHexSchema,
  blockDaaScore: u64DecimalSchema,
};

const activationSchema = z
  .object({
    kind: z.literal("activate"),
    ...transitionBase,
    prizeOutputIndex: outputIndexSchema,
    shardOutputIndexes: z.array(outputIndexSchema).min(1).max(4),
  })
  .strict();

const registrationSchema = z
  .object({
    kind: z.literal("register"),
    ...transitionBase,
    shardIndex: z.number().int().min(0).max(3),
    consumedOutpoint: outpointSchema,
    producedOutputIndex: outputIndexSchema,
    payoutScriptPublicKeyHex: scriptHexSchema,
  })
  .strict();

const freezeSchema = z
  .object({
    kind: z.literal("freeze"),
    ...transitionBase,
    prizeInputOutpoint: outpointSchema,
    shardInputOutpoints: z.array(outpointSchema).min(1).max(4),
    frozenOutputIndex: outputIndexSchema,
    observedFrozenRootHex: hashHexSchema,
    observedEntryCount: countSchema,
  })
  .strict();

const drawSchema = z
  .object({
    kind: z.literal("draw"),
    ...transitionBase,
    frozenInputOutpoint: outpointSchema,
    parentBlockHashHex: hashHexSchema,
    parentBlueScore: u64DecimalSchema,
    parentSequenceCommitmentHex: hashHexSchema,
    candidateBlockHashHex: hashHexSchema,
    candidateBlueScore: u64DecimalSchema,
    candidateSequenceCommitmentHex: hashHexSchema,
    winnerOutputScriptPublicKeyHex: scriptHexSchema,
    returnOutputScriptPublicKeyHex: scriptHexSchema,
  })
  .strict();

const returnSchema = z
  .object({
    kind: z.literal("return"),
    ...transitionBase,
    frozenInputOutpoint: outpointSchema,
    returnOutputScriptPublicKeyHex: scriptHexSchema,
  })
  .strict();

const chainEventsSchema = z.array(
  z.discriminatedUnion("kind", [
    activationSchema,
    registrationSchema,
    freezeSchema,
    drawSchema,
    returnSchema,
  ]),
);

/** Parses protocol configuration from a JSON-safe object with decimal u64 strings. */
export function parseGiveawayV6ConfigJson(value: unknown): GiveawayV6ReconstructionConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    throw new GiveawayV6ReconstructionError(
      "INVALID_CONFIG",
      "Giveaway V6 configuration is malformed.",
    );
  }
  return parsed.data;
}

/** Converts all uint64 configuration values to unambiguous decimal JSON strings. */
export function serializeGiveawayV6ConfigJson(
  config: GiveawayV6ReconstructionConfig,
): GiveawayV6ConfigJson {
  const validated = parseGiveawayV6ConfigJson({
    ...config,
    closesAtDaa: config.closesAtDaa.toString(),
    returnAtDaa: config.returnAtDaa.toString(),
    entropyTargetBlueScore: config.entropyTargetBlueScore.toString(),
  });
  return {
    ...validated,
    closesAtDaa: validated.closesAtDaa.toString(),
    returnAtDaa: validated.returnAtDaa.toString(),
    entropyTargetBlueScore: validated.entropyTargetBlueScore.toString(),
  };
}

/** Parses decoded public-chain transitions and rejects unknown fields. */
export function parseGiveawayV6ChainEventsJson(value: unknown): GiveawayV6ChainEvent[] {
  const parsed = chainEventsSchema.safeParse(value);
  if (!parsed.success) {
    throw new GiveawayV6ReconstructionError(
      "INVALID_EVENT",
      "Giveaway V6 chain transition data is malformed.",
    );
  }
  return parsed.data;
}

/** Safe JSON boundary for restart/reindex workers and read-only verification APIs. */
export function reconstructGiveawayV6FromJson(
  config: unknown,
  events: unknown,
): GiveawayV6ReconstructionSnapshot {
  return reconstructGiveawayV6(
    parseGiveawayV6ConfigJson(config),
    parseGiveawayV6ChainEventsJson(events),
  );
}
