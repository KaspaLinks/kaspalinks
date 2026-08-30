import { actorContext, createTelegramConnectCodeTool } from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";

import { applicationErrorResponse } from "@/lib/application-errors";
import { requireCreator } from "@/lib/creator-guard";
import { apiJson, apiMethodNotAllowed } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export async function POST(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit(RateBuckets.AGENT_CONNECTION_CODE, guard.creator.id);
  if (!limited.allowed) return limited.response;
  try {
    const result = await createTelegramConnectCodeTool(
      prisma,
      actorContext(guard.creator.id, "web"),
    );
    const bot = process.env.TELEGRAM_BOT_USERNAME?.trim();
    return apiJson({
      code: result.code,
      deepLink: bot ? `https://t.me/${bot}?start=${encodeURIComponent(result.code)}` : null,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export { methodNotAllowed as DELETE, methodNotAllowed as GET, methodNotAllowed as PATCH };
