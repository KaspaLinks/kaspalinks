import { type PrismaClient } from "@kaspa-actions/db";
import { validateKaspaAddress } from "@kaspa-actions/kaspa";
import { z } from "zod";

import type { ActorContext } from "./actor.ts";
import { ApplicationError } from "./errors.ts";

const settingsSchema = z.object({
  aiConsent: z.boolean().optional(),
  defaultRecipientAddress: z.string().trim().nullable().optional(),
  notificationsEnabled: z.boolean().optional(),
  supporterDetailsEnabled: z.boolean().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export type UpdateAgentSettingsInput = z.input<typeof settingsSchema>;

export function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function getAgentSettingsTool(prisma: PrismaClient, actor: ActorContext) {
  const creator = await prisma.creator.findUnique({
    include: { telegramConnection: true },
    where: { id: actor.creatorId },
  });
  if (!creator) throw new ApplicationError("ACTOR_NOT_FOUND", "Creator not found.", 404);

  return {
    aiConsentAt: creator.agentAiConsentAt,
    aiEnabled: creator.agentAiEnabled,
    defaultRecipientAddress: creator.defaultRecipientAddress,
    telegramBetaEnabled: creator.telegramBetaEnabled,
    telegramConnection: creator.telegramConnection,
    timezone: creator.timezone,
    waitlistAt: creator.agentWaitlistAt,
  };
}

export async function updateAgentSettingsTool(
  prisma: PrismaClient,
  actor: ActorContext,
  rawInput: UpdateAgentSettingsInput,
) {
  const parsed = settingsSchema.safeParse(rawInput);
  if (!parsed.success) throw new ApplicationError("INVALID_SETTINGS", "Invalid Agent settings.");
  const input = parsed.data;

  if (input.timezone && !isIanaTimezone(input.timezone)) {
    throw new ApplicationError("INVALID_TIMEZONE", "Use a valid IANA timezone.");
  }
  if (input.defaultRecipientAddress) {
    const result = validateKaspaAddress(input.defaultRecipientAddress);
    if (!result.valid || result.network !== "mainnet") {
      throw new ApplicationError(
        "INVALID_RECIPIENT_ADDRESS",
        "Default recipient must be a valid mainnet Kaspa address.",
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const creator = await tx.creator.update({
      data: {
        ...(input.aiConsent !== undefined
          ? { agentAiConsentAt: input.aiConsent ? new Date() : null }
          : {}),
        ...(input.defaultRecipientAddress !== undefined
          ? { defaultRecipientAddress: input.defaultRecipientAddress || null }
          : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      },
      where: { id: actor.creatorId },
    });

    if (input.notificationsEnabled !== undefined || input.supporterDetailsEnabled !== undefined) {
      const connection = await tx.telegramConnection.findUnique({
        where: { creatorId: actor.creatorId },
      });
      if (!connection) {
        throw new ApplicationError("TELEGRAM_NOT_CONNECTED", "Connect Telegram first.", 409);
      }
      if (connection.blockedAt && input.notificationsEnabled) {
        throw new ApplicationError(
          "TELEGRAM_DELIVERY_BLOCKED",
          "Reconnect Telegram before enabling notifications.",
          409,
        );
      }
      await tx.telegramConnection.update({
        data: {
          ...(input.notificationsEnabled !== undefined
            ? { notificationsEnabled: input.notificationsEnabled }
            : {}),
          ...(input.supporterDetailsEnabled !== undefined
            ? { supporterDetailsEnabled: input.supporterDetailsEnabled }
            : {}),
        },
        where: { id: connection.id },
      });
    }

    return creator;
  });
}

export async function joinAgentWaitlistTool(prisma: PrismaClient, actor: ActorContext) {
  return prisma.creator.update({
    data: { agentWaitlistAt: new Date() },
    where: { id: actor.creatorId },
  });
}

export async function setAgentAccessTool(
  prisma: PrismaClient,
  creatorId: string,
  input: { aiEnabled?: boolean; telegramBetaEnabled?: boolean },
) {
  return prisma.$transaction(async (tx) => {
    const creator = await tx.creator.update({
      data: {
        ...(input.aiEnabled !== undefined ? { agentAiEnabled: input.aiEnabled } : {}),
        ...(input.telegramBetaEnabled !== undefined
          ? { telegramBetaEnabled: input.telegramBetaEnabled }
          : {}),
      },
      where: { id: creatorId },
    });
    if (input.telegramBetaEnabled === false) {
      await tx.telegramConnectCode.deleteMany({ where: { creatorId } });
      await tx.telegramConnection.deleteMany({ where: { creatorId } });
    }
    return creator;
  });
}
