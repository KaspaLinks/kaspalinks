import { z } from "zod";

import type { GiveawayV6FamilyDescriptor } from "./giveaway-v6-projector";

const MAX_U64 = (1n << 64n) - 1n;

const hashHexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/u)
  .transform((value) => value.toLowerCase());

const positiveU64DecimalSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/u)
  .transform((value, context) => {
    const parsed = BigInt(value);
    if (parsed > MAX_U64) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Value exceeds uint64." });
      return z.NEVER;
    }
    return parsed;
  });

const familySchema = z
  .object({
    genesisOutpoint: z
      .object({
        transactionId: hashHexSchema,
        outputIndex: z.number().int().min(0).max(0xffffffff),
      })
      .strict(),
    covenantIdHex: hashHexSchema,
    prizeTemplateHashHex: hashHexSchema,
    shardTemplateHashHex: hashHexSchema,
    prizeValueSompi: positiveU64DecimalSchema,
    shardValueSompi: positiveU64DecimalSchema,
    entryFeeSompi: positiveU64DecimalSchema,
    activationFeeSompi: positiveU64DecimalSchema,
    freezeFeeSompi: positiveU64DecimalSchema,
    drawFeeSompi: positiveU64DecimalSchema,
    returnFeeSompi: positiveU64DecimalSchema,
  })
  .strict();

export type GiveawayV6FamilyJson = {
  genesisOutpoint: { transactionId: string; outputIndex: number };
  covenantIdHex: string;
  prizeTemplateHashHex: string;
  shardTemplateHashHex: string;
  prizeValueSompi: string;
  shardValueSompi: string;
  entryFeeSompi: string;
  activationFeeSompi: string;
  freezeFeeSompi: string;
  drawFeeSompi: string;
  returnFeeSompi: string;
};

export class GiveawayV6FamilyJsonError extends Error {
  readonly code = "INVALID_FAMILY" as const;

  constructor() {
    super("Giveaway V6 covenant family is malformed.");
    this.name = "GiveawayV6FamilyJsonError";
  }
}

/** Strictly restores public covenant-family data from a database JSON column. */
export function parseGiveawayV6FamilyJson(value: unknown): GiveawayV6FamilyDescriptor {
  const parsed = familySchema.safeParse(value);
  if (!parsed.success) throw new GiveawayV6FamilyJsonError();
  return parsed.data;
}

/** Converts every family amount to a decimal JSON string and normalizes hashes. */
export function serializeGiveawayV6FamilyJson(
  family: GiveawayV6FamilyDescriptor,
): GiveawayV6FamilyJson {
  const validated = parseGiveawayV6FamilyJson({
    ...family,
    prizeValueSompi: family.prizeValueSompi.toString(),
    shardValueSompi: family.shardValueSompi.toString(),
    entryFeeSompi: family.entryFeeSompi.toString(),
    activationFeeSompi: family.activationFeeSompi.toString(),
    freezeFeeSompi: family.freezeFeeSompi.toString(),
    drawFeeSompi: family.drawFeeSompi.toString(),
    returnFeeSompi: family.returnFeeSompi.toString(),
  });
  return {
    ...validated,
    prizeValueSompi: validated.prizeValueSompi.toString(),
    shardValueSompi: validated.shardValueSompi.toString(),
    entryFeeSompi: validated.entryFeeSompi.toString(),
    activationFeeSompi: validated.activationFeeSompi.toString(),
    freezeFeeSompi: validated.freezeFeeSompi.toString(),
    drawFeeSompi: validated.drawFeeSompi.toString(),
    returnFeeSompi: validated.returnFeeSompi.toString(),
  };
}
