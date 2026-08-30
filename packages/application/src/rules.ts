import { ActionType, NotificationRuleKind, type PrismaClient } from "@kaspa-actions/db";
import { parseKaspaAmountToSompi } from "@kaspa-actions/kaspa";
import { z } from "zod";

import type { ActorContext } from "./actor.ts";
import { ApplicationError } from "./errors.ts";

const createRuleSchema = z
  .object({
    actionId: z.string().trim().min(1).optional(),
    completeOnInvoicePayment: z.boolean().optional(),
    kind: z.nativeEnum(NotificationRuleKind),
    minimumKas: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    const needsAction =
      value.kind === NotificationRuleKind.ACTION ||
      value.kind === NotificationRuleKind.ACTION_MINIMUM_AMOUNT;
    const needsAmount =
      value.kind === NotificationRuleKind.MINIMUM_AMOUNT ||
      value.kind === NotificationRuleKind.ACTION_MINIMUM_AMOUNT;
    if (needsAction !== Boolean(value.actionId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Rule action is invalid." });
    }
    if (needsAmount !== Boolean(value.minimumKas)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Rule minimum is invalid." });
    }
  });

export type CreateNotificationRuleInput = z.input<typeof createRuleSchema>;

export async function createNotificationRuleTool(
  prisma: PrismaClient,
  actor: ActorContext,
  rawInput: CreateNotificationRuleInput,
) {
  const parsed = createRuleSchema.safeParse(rawInput);
  if (!parsed.success) throw new ApplicationError("INVALID_RULE", "Invalid notification rule.");
  const input = parsed.data;
  const minimumSompi = input.minimumKas ? parseKaspaAmountToSompi(input.minimumKas) : null;

  let action: null | { id: string; type: ActionType } = null;
  if (input.actionId) {
    action = await prisma.action.findFirst({
      select: { id: true, type: true },
      where: { creatorId: actor.creatorId, deletedAt: null, id: input.actionId },
    });
    if (!action) throw new ApplicationError("ACTION_NOT_FOUND", "Action not found.", 404);
  }

  if (input.completeOnInvoicePayment && action?.type !== ActionType.KASPA_INVOICE) {
    throw new ApplicationError(
      "INVALID_RULE",
      "Only an invoice-specific rule can complete after payment.",
    );
  }

  return prisma.notificationRule.create({
    data: {
      actionId: action?.id ?? null,
      completeOnInvoicePayment: input.completeOnInvoicePayment ?? false,
      creatorId: actor.creatorId,
      kind: input.kind,
      minimumSompi,
    },
  });
}

export async function setNotificationRuleStatusTool(
  prisma: PrismaClient,
  actor: ActorContext,
  ruleId: string,
  status: "ACTIVE" | "PAUSED",
) {
  const updated = await prisma.notificationRule.updateMany({
    data: { completedAt: null, status },
    where: { creatorId: actor.creatorId, id: ruleId },
  });
  if (updated.count !== 1) throw new ApplicationError("RULE_NOT_FOUND", "Rule not found.", 404);
}

export async function deleteNotificationRuleTool(
  prisma: PrismaClient,
  actor: ActorContext,
  ruleId: string,
) {
  const deleted = await prisma.notificationRule.deleteMany({
    where: { creatorId: actor.creatorId, id: ruleId },
  });
  if (deleted.count !== 1) throw new ApplicationError("RULE_NOT_FOUND", "Rule not found.", 404);
}

export function notificationRuleMatches(
  rule: { actionId: null | string; kind: NotificationRuleKind; minimumSompi: bigint | null },
  payment: { actionId: string; amountSompi: bigint },
): boolean {
  switch (rule.kind) {
    case NotificationRuleKind.ALL_PAYMENTS:
      return true;
    case NotificationRuleKind.ACTION:
      return rule.actionId === payment.actionId;
    case NotificationRuleKind.MINIMUM_AMOUNT:
      return rule.minimumSompi !== null && payment.amountSompi >= rule.minimumSompi;
    case NotificationRuleKind.ACTION_MINIMUM_AMOUNT:
      return (
        rule.actionId === payment.actionId &&
        rule.minimumSompi !== null &&
        payment.amountSompi >= rule.minimumSompi
      );
  }
}
