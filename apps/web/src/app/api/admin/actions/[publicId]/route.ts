import { prisma } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";

import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { formatZodErrorMessage, updateActionInputSchema } from "@/lib/schemas";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { publicId } = await context.params;

  const guard = await requireAdmin(request, prisma, {
    event: "admin.update_action_unauthorized",
    metadata: { publicId },
  });
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.ADMIN_MUTATION, guard.ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = updateActionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

  const action = await prisma.action.findUnique({ where: { publicId } });
  if (!action) {
    return apiError(ErrorCodes.NOT_FOUND, "Action not found.", 404);
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.message !== undefined) updates.message = parsed.data.message;
  if (parsed.data.expiresAt !== undefined) updates.expiresAt = parsed.data.expiresAt;
  if (parsed.data.disabled !== undefined) {
    updates.disabledAt = parsed.data.disabled ? new Date() : null;
  }

  const updated = await prisma.action.update({
    data: updates,
    where: { id: action.id },
  });

  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.ADMIN,
    event:
      parsed.data.disabled === true
        ? "action.disabled"
        : parsed.data.disabled === false
          ? "action.enabled"
          : "action.updated",
    ipHash: guard.ipHash,
    metadata: { fields: Object.keys(updates), publicId: action.publicId },
  });

  return apiJson({
    action: {
      disabledAt: updated.disabledAt ? updated.disabledAt.toISOString() : null,
      publicId: updated.publicId,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["PATCH"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
