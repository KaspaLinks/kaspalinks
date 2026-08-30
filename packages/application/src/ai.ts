import { AgentIntentStatus, Prisma, type PrismaClient } from "@kaspa-actions/db";
import { z } from "zod";

import { createActionTool, type CreateActionInput } from "./actions.ts";
import type { ActorContext } from "./actor.ts";
import { ApplicationError } from "./errors.ts";
import { createNotificationRuleTool, type CreateNotificationRuleInput } from "./rules.ts";

const AI_MINUTE_LIMIT = 5;
const AI_DAY_LIMIT = 25;
const AI_MONTH_LIMIT = 100;
const AI_GLOBAL_REQUEST_LIMIT = 2_000;
const AI_GLOBAL_COST_LIMIT_MICROS = 5_000_000n;
const AI_WARNING_PERCENT = 80;

export type AgentMutationIntent =
  | { intent: "create_action"; payload: CreateActionInput }
  | { intent: "create_notification_rule"; payload: CreateNotificationRuleInput };

export type AiQuotaReservation = {
  globalPeriodKey: string;
  reservedCostMicros: bigint;
  warning: boolean;
};

function zonedDateParts(date: Date, timeZone: string): { day: string; month: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return { day, month: day.slice(0, 7) };
}

export async function reserveAiQuota(
  prisma: PrismaClient,
  actor: ActorContext,
  timezone: string,
  reservedCostMicros: bigint,
  now = new Date(),
): Promise<AiQuotaReservation> {
  const zoned = zonedDateParts(now, timezone);
  const minute = Math.floor(now.getTime() / 60_000).toString();
  const globalPeriodKey = now.toISOString().slice(0, 7);
  const buckets = [
    { limit: AI_MINUTE_LIMIT, periodKey: minute, scope: "creator-minute" },
    { limit: AI_DAY_LIMIT, periodKey: zoned.day, scope: "creator-day" },
    { limit: AI_MONTH_LIMIT, periodKey: zoned.month, scope: "creator-month" },
  ];

  const global = await prisma.$transaction(async (tx) => {
    for (const bucket of buckets) {
      await tx.agentQuotaBucket.upsert({
        create: {
          periodKey: bucket.periodKey,
          scope: bucket.scope,
          scopeKey: actor.creatorId,
        },
        update: {},
        where: {
          scope_scopeKey_periodKey: {
            periodKey: bucket.periodKey,
            scope: bucket.scope,
            scopeKey: actor.creatorId,
          },
        },
      });
      const incremented = await tx.agentQuotaBucket.updateMany({
        data: { requestCount: { increment: 1 } },
        where: {
          periodKey: bucket.periodKey,
          requestCount: { lt: bucket.limit },
          scope: bucket.scope,
          scopeKey: actor.creatorId,
        },
      });
      if (incremented.count !== 1) {
        throw new ApplicationError("AI_QUOTA_REACHED", "AI quota reached for this period.", 429);
      }
    }

    await tx.agentQuotaBucket.upsert({
      create: { periodKey: globalPeriodKey, scope: "global-month", scopeKey: "global" },
      update: {},
      where: {
        scope_scopeKey_periodKey: {
          periodKey: globalPeriodKey,
          scope: "global-month",
          scopeKey: "global",
        },
      },
    });
    const incremented = await tx.agentQuotaBucket.updateMany({
      data: {
        estimatedCostMicros: { increment: reservedCostMicros },
        requestCount: { increment: 1 },
      },
      where: {
        estimatedCostMicros: { lte: AI_GLOBAL_COST_LIMIT_MICROS - reservedCostMicros },
        periodKey: globalPeriodKey,
        requestCount: { lt: AI_GLOBAL_REQUEST_LIMIT },
        scope: "global-month",
        scopeKey: "global",
      },
    });
    if (incremented.count !== 1) {
      throw new ApplicationError("AI_GLOBAL_LIMIT_REACHED", "AI is temporarily unavailable.", 503);
    }
    return tx.agentQuotaBucket.findUniqueOrThrow({
      where: {
        scope_scopeKey_periodKey: {
          periodKey: globalPeriodKey,
          scope: "global-month",
          scopeKey: "global",
        },
      },
    });
  });

  const requestPercent = (global.requestCount * 100) / AI_GLOBAL_REQUEST_LIMIT;
  const costPercent = Number((global.estimatedCostMicros * 100n) / AI_GLOBAL_COST_LIMIT_MICROS);
  return {
    globalPeriodKey,
    reservedCostMicros,
    warning: Math.max(requestPercent, costPercent) >= AI_WARNING_PERCENT,
  };
}

export async function recordAiUsage(
  prisma: PrismaClient,
  actor: ActorContext,
  reservation: AiQuotaReservation,
  input: {
    actualCostMicros: bigint;
    errorCode?: null | string;
    inputTokens?: number;
    intent?: null | string;
    model: string;
    outputTokens?: number;
    status: string;
  },
) {
  const delta = input.actualCostMicros - reservation.reservedCostMicros;
  await prisma.$transaction([
    prisma.aiUsageEvent.create({
      data: {
        creatorId: actor.creatorId,
        errorCode: input.errorCode ?? null,
        estimatedCostMicros: input.actualCostMicros,
        inputTokens: input.inputTokens,
        intent: input.intent ?? null,
        model: input.model,
        outputTokens: input.outputTokens,
        status: input.status,
      },
    }),
    prisma.agentQuotaBucket.update({
      data: { estimatedCostMicros: { increment: delta } },
      where: {
        scope_scopeKey_periodKey: {
          periodKey: reservation.globalPeriodKey,
          scope: "global-month",
          scopeKey: "global",
        },
      },
    }),
  ]);
}

export async function createIntentDraftTool(
  prisma: PrismaClient,
  actor: ActorContext,
  telegramUserId: string,
  mutation: AgentMutationIntent,
  now = new Date(),
) {
  return prisma.agentIntentDraft.create({
    data: {
      creatorId: actor.creatorId,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      intent: mutation.intent,
      payload: mutation.payload as object,
      telegramUserId,
    },
  });
}

export async function createClarificationDraftTool(
  prisma: PrismaClient,
  actor: ActorContext,
  telegramUserId: string,
  partialState: Record<string, unknown>,
  now = new Date(),
) {
  return prisma.agentIntentDraft.create({
    data: {
      creatorId: actor.creatorId,
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      intent: "needs_clarification",
      payload: partialState as Prisma.InputJsonValue,
      status: AgentIntentStatus.NEEDS_CLARIFICATION,
      telegramUserId,
    },
  });
}

const actionPayloadSchema = z.object({
  amountKas: z.string().optional(),
  amountSompi: z.string().optional(),
  description: z.string().optional(),
  expiresAt: z.date().nullable().optional(),
  goalAutoClose: z.boolean().optional(),
  goalKas: z.string().optional(),
  goalSompi: z.string().optional(),
  hiddenFromProfile: z.boolean().optional(),
  message: z.string().optional(),
  noteRequired: z.boolean().optional(),
  recipientAddress: z.string(),
  slug: z.string(),
  title: z.string(),
  type: z.enum(["kaspa.transfer", "kaspa.tip", "kaspa.donation", "kaspa.invoice", "kaspa.goal"]),
});

const rulePayloadSchema = z.object({
  actionId: z.string().optional(),
  completeOnInvoicePayment: z.boolean().optional(),
  kind: z.enum(["ALL_PAYMENTS", "ACTION", "MINIMUM_AMOUNT", "ACTION_MINIMUM_AMOUNT"]),
  minimumKas: z.string().optional(),
});

export async function confirmIntentDraftTool(
  prisma: PrismaClient,
  actor: ActorContext,
  telegramUserId: string,
  draftId: string,
) {
  const claimed = await prisma.agentIntentDraft.updateMany({
    data: { status: AgentIntentStatus.EXECUTING },
    where: {
      creatorId: actor.creatorId,
      expiresAt: { gt: new Date() },
      id: draftId,
      status: AgentIntentStatus.PENDING_CONFIRMATION,
      telegramUserId,
    },
  });
  if (claimed.count !== 1) {
    const existing = await prisma.agentIntentDraft.findFirst({
      where: { creatorId: actor.creatorId, id: draftId, telegramUserId },
    });
    if (existing?.status === AgentIntentStatus.CONFIRMED) {
      return { alreadyConfirmed: true, resultRef: existing.resultRef };
    }
    throw new ApplicationError("DRAFT_UNAVAILABLE", "Draft expired or already handled.", 409);
  }

  const draft = await prisma.agentIntentDraft.findUniqueOrThrow({ where: { id: draftId } });
  try {
    let resultRef: string;
    if (draft.intent === "create_action") {
      const payload = actionPayloadSchema.parse(draft.payload);
      const action = await createActionTool(prisma, actor, payload, {
        idempotencyKey: `agent-draft:${draft.id}`,
      });
      resultRef = action.publicId;
    } else if (draft.intent === "create_notification_rule") {
      const payload = rulePayloadSchema.parse(draft.payload);
      const rule = await createNotificationRuleTool(prisma, actor, payload);
      resultRef = rule.id;
    } else {
      throw new ApplicationError("DRAFT_INTENT_INVALID", "Draft intent is not executable.");
    }

    await prisma.agentIntentDraft.update({
      data: { confirmedAt: new Date(), resultRef, status: AgentIntentStatus.CONFIRMED },
      where: { id: draft.id },
    });
    return { alreadyConfirmed: false, resultRef };
  } catch (error) {
    await prisma.agentIntentDraft.updateMany({
      data: { status: AgentIntentStatus.FAILED },
      where: { id: draft.id, status: AgentIntentStatus.EXECUTING },
    });
    throw error;
  }
}

export async function expireAgentData(prisma: PrismaClient, now = new Date()) {
  const staleExecutionCutoff = new Date(now.getTime() - 15 * 60_000);
  await prisma.$transaction([
    prisma.agentIntentDraft.updateMany({
      data: { status: AgentIntentStatus.EXPIRED },
      where: {
        expiresAt: { lte: now },
        status: {
          in: [AgentIntentStatus.PENDING_CONFIRMATION, AgentIntentStatus.NEEDS_CLARIFICATION],
        },
      },
    }),
    prisma.agentIntentDraft.updateMany({
      data: { status: AgentIntentStatus.FAILED },
      where: {
        status: AgentIntentStatus.EXECUTING,
        updatedAt: { lte: staleExecutionCutoff },
      },
    }),
    prisma.telegramConnectCode.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.telegramUpdate.deleteMany({
      where: { receivedAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } },
    }),
    prisma.aiUsageEvent.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } },
    }),
  ]);
}
