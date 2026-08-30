import { actorContext, readGiveawaySetupDraftTool } from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { applicationErrorResponse } from "@/lib/application-errors";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";

type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway setup draft was not found.", 404);
  }

  try {
    const result = await readGiveawaySetupDraftTool(
      prisma,
      actorContext(guard.creator.id, "web"),
      parsedId.data,
    );
    return apiJson({
      draft: result.draft,
      expiresAt: result.expiresAt.toISOString(),
      id: result.id,
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);
export { methodNotAllowed as DELETE, methodNotAllowed as PATCH, methodNotAllowed as POST };
