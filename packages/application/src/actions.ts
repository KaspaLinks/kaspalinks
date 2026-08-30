import { ActionType, AuditActorType, Network, type PrismaClient } from "@kaspa-actions/db";
import {
  parseKaspaAmountToSompi,
  parseSompiAmount,
  validateKaspaAddress,
} from "@kaspa-actions/kaspa";
import { z } from "zod";

import type { ActorContext } from "./actor.ts";
import { ApplicationError } from "./errors.ts";

export const APPLICATION_ACTION_TYPES = [
  "kaspa.transfer",
  "kaspa.tip",
  "kaspa.donation",
  "kaspa.invoice",
  "kaspa.goal",
] as const;

const actionTypeMap: Record<(typeof APPLICATION_ACTION_TYPES)[number], ActionType> = {
  "kaspa.donation": ActionType.KASPA_DONATION,
  "kaspa.goal": ActionType.KASPA_GOAL,
  "kaspa.invoice": ActionType.KASPA_INVOICE,
  "kaspa.tip": ActionType.KASPA_TIP,
  "kaspa.transfer": ActionType.KASPA_TRANSFER,
};

const createActionSchema = z
  .object({
    amountKas: z.string().trim().optional(),
    amountSompi: z.string().trim().optional(),
    description: z.string().trim().max(280).nullable().optional(),
    expiresAt: z.date().nullable().optional(),
    goalAutoClose: z.boolean().optional(),
    goalKas: z.string().trim().optional(),
    goalSompi: z.string().trim().optional(),
    hiddenFromProfile: z.boolean().optional(),
    message: z.string().trim().max(280).nullable().optional(),
    noteRequired: z.boolean().optional(),
    recipientAddress: z.string().trim(),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
    title: z.string().trim().min(1).max(80),
    type: z.enum(APPLICATION_ACTION_TYPES),
  })
  .superRefine((value, context) => {
    const address = validateKaspaAddress(value.recipientAddress);
    if (!address.valid || address.network !== "mainnet") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recipientAddress must be a valid mainnet Kaspa address.",
        path: ["recipientAddress"],
      });
    }

    const fixed = value.type === "kaspa.invoice" || value.type === "kaspa.transfer";
    if (fixed && !value.amountKas && !value.amountSompi) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${value.type} requires amountKas.`,
        path: ["amountKas"],
      });
    }
    if (value.type === "kaspa.goal" && !value.goalKas && !value.goalSompi) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "kaspa.goal requires goalKas.",
        path: ["goalKas"],
      });
    }
  });

export type CreateActionInput = z.input<typeof createActionSchema>;

function normalizeOptional(value: null | string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function slugCandidate(base: string, attempt: number): string {
  if (attempt === 0) return base;
  const suffix = `-${attempt + 1}`;
  return `${base.slice(0, 64 - suffix.length).replace(/[-_]+$/, "")}${suffix}`;
}

export async function createActionTool(
  prisma: PrismaClient,
  actor: ActorContext,
  rawInput: CreateActionInput,
  options: {
    dailyLimit?: number;
    idempotencyKey?: string;
    ipHash?: null | string;
    now?: Date;
  } = {},
) {
  const parsed = createActionSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ApplicationError(
      "INVALID_ACTION",
      parsed.error.issues[0]?.message ?? "Invalid action.",
    );
  }

  const input = parsed.data;
  const now = options.now ?? new Date();
  const dailyLimit = options.dailyLimit ?? 50;
  const amountSompi = input.amountKas
    ? parseKaspaAmountToSompi(input.amountKas)
    : input.amountSompi
      ? parseSompiAmount(input.amountSompi)
      : null;
  const goalSompi = input.goalKas
    ? parseKaspaAmountToSompi(input.goalKas)
    : input.goalSompi
      ? parseSompiAmount(input.goalSompi)
      : null;

  return prisma.$transaction(async (tx) => {
    if (options.idempotencyKey) {
      const existing = await tx.action.findUnique({
        where: { agentCommandKey: options.idempotencyKey },
      });
      if (existing) {
        if (existing.creatorId !== actor.creatorId) {
          throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Command key is already in use.", 409);
        }
        return existing;
      }
    }
    const creator = await tx.creator.findUnique({ where: { id: actor.creatorId } });
    if (!creator) throw new ApplicationError("ACTOR_NOT_FOUND", "Creator not found.", 404);

    const recentCount = await tx.action.count({
      where: {
        createdAt: { gte: new Date(now.getTime() - 86_400_000) },
        creatorId: actor.creatorId,
      },
    });
    if (recentCount >= dailyLimit) {
      throw new ApplicationError(
        "ACTION_LIMIT_REACHED",
        "Daily Action creation limit reached.",
        429,
      );
    }

    let slug: string | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = slugCandidate(input.slug, attempt);
      const existing = await tx.action.findFirst({
        select: { id: true },
        where: { creatorId: actor.creatorId, slug: candidate },
      });
      if (!existing) {
        slug = candidate;
        break;
      }
    }
    if (!slug) {
      throw new ApplicationError("SLUG_TAKEN", "Could not create a unique link URL.", 409);
    }

    const type = actionTypeMap[input.type];
    const hiddenFromProfile =
      input.hiddenFromProfile ??
      (type === ActionType.KASPA_INVOICE || type === ActionType.KASPA_TRANSFER);
    const visibleCount = await tx.action.count({
      where: {
        creatorId: actor.creatorId,
        deletedAt: null,
        disabledAt: null,
        hiddenFromProfile: false,
      },
    });

    const action = await tx.action.create({
      data: {
        agentCommandKey: options.idempotencyKey ?? null,
        amountSompi,
        creatorId: actor.creatorId,
        description: normalizeOptional(input.description),
        expiresAt: input.expiresAt ?? null,
        goalAutoClose: input.type === "kaspa.goal" ? (input.goalAutoClose ?? false) : false,
        goalSompi,
        hiddenFromProfile,
        message: normalizeOptional(input.message),
        network: Network.MAINNET,
        noteRequired: input.noteRequired ?? false,
        recipientAddress: input.recipientAddress,
        slug,
        title: input.title,
        type,
      },
    });

    let quickTipAutoAssigned = false;
    if (creator.tipActionId === null && !hiddenFromProfile && visibleCount === 0) {
      const assigned = await tx.creator.updateMany({
        data: { tipActionId: action.id },
        where: { id: actor.creatorId, tipActionId: null },
      });
      quickTipAutoAssigned = assigned.count === 1;
    }

    await tx.auditLog.create({
      data: {
        actionId: action.id,
        actorType: AuditActorType.CREATOR,
        creatorId: actor.creatorId,
        event: "creator.action_created",
        ipHash: options.ipHash ?? null,
        metadata: {
          channel: actor.channel,
          publicId: action.publicId,
          quickTipAutoAssigned,
          slug,
          type: input.type,
          variableAmount: amountSompi === null,
        },
      },
    });

    return action;
  });
}

export async function setActionEnabledTool(
  prisma: PrismaClient,
  actor: ActorContext,
  actionId: string,
  enabled: boolean,
) {
  const updated = await prisma.action.updateMany({
    data: { disabledAt: enabled ? null : new Date() },
    where: { id: actionId, creatorId: actor.creatorId, deletedAt: null },
  });
  if (updated.count !== 1) throw new ApplicationError("ACTION_NOT_FOUND", "Action not found.", 404);
}

export async function deleteActionTool(
  prisma: PrismaClient,
  actor: ActorContext,
  actionId: string,
) {
  const updated = await prisma.action.updateMany({
    data: { deletedAt: new Date(), disabledAt: new Date(), hiddenFromProfile: true },
    where: { id: actionId, creatorId: actor.creatorId, deletedAt: null },
  });
  if (updated.count !== 1) throw new ApplicationError("ACTION_NOT_FOUND", "Action not found.", 404);
}
