import { actorContext, disconnectTelegramTool } from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";

import { requireCreator } from "@/lib/creator-guard";
import { apiJson, apiMethodNotAllowed } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export async function DELETE(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit(RateBuckets.AGENT_MUTATION, guard.creator.id);
  if (!limited.allowed) return limited.response;
  const disconnected = await disconnectTelegramTool(prisma, actorContext(guard.creator.id, "web"));
  return apiJson({ disconnected });
}

const methodNotAllowed = () => apiMethodNotAllowed(["DELETE"]);
export { methodNotAllowed as GET, methodNotAllowed as PATCH, methodNotAllowed as POST };
