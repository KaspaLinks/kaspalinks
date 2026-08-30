import {
  actorContext,
  getAgentSettingsTool,
  updateAgentSettingsTool,
} from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";

import { applicationErrorResponse } from "@/lib/application-errors";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;
  const settings = await getAgentSettingsTool(prisma, actorContext(guard.creator.id, "web"));
  return apiJson({
    settings: {
      aiConsentAt: settings.aiConsentAt?.toISOString() ?? null,
      aiEnabled: settings.aiEnabled,
      defaultRecipientAddress: settings.defaultRecipientAddress,
      telegramBetaEnabled: settings.telegramBetaEnabled,
      telegramConnection: settings.telegramConnection
        ? {
            blockedAt: settings.telegramConnection.blockedAt?.toISOString() ?? null,
            connectedAt: settings.telegramConnection.createdAt.toISOString(),
            disabledReason: settings.telegramConnection.disabledReason,
            notificationsEnabled: settings.telegramConnection.notificationsEnabled,
            supporterDetailsEnabled: settings.telegramConnection.supporterDetailsEnabled,
          }
        : null,
      telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() ?? null,
      timezone: settings.timezone,
      waitlistAt: settings.waitlistAt?.toISOString() ?? null,
    },
  });
}

export async function PATCH(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit(RateBuckets.AGENT_MUTATION, guard.creator.id);
  if (!limited.allowed) return limited.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  try {
    await updateAgentSettingsTool(prisma, actorContext(guard.creator.id, "web"), body as never);
    return GET(request);
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "PATCH"]);
export { methodNotAllowed as DELETE, methodNotAllowed as POST, methodNotAllowed as PUT };
