import { setAgentAccessTool } from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

type RouteContext = { params: Promise<{ username: string }> };
const bodySchema = z
  .object({ aiEnabled: z.boolean().optional(), telegramBetaEnabled: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin(request, prisma, { event: "admin.agent_access_failed" });
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit(RateBuckets.ADMIN_MUTATION, guard.ipHash);
  if (!limited.allowed) return limited.response;
  const { username } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid access settings.", 400);
  const creator = await prisma.creator.findUnique({ where: { username: username.toLowerCase() } });
  if (!creator) return apiError(ErrorCodes.NOT_FOUND, "Creator not found.", 404);
  const updated = await setAgentAccessTool(prisma, creator.id, parsed.data);
  return apiJson({
    creator: {
      aiEnabled: updated.agentAiEnabled,
      telegramBetaEnabled: updated.telegramBetaEnabled,
      username: updated.username,
    },
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["PATCH"]);
export { methodNotAllowed as DELETE, methodNotAllowed as GET, methodNotAllowed as POST };
