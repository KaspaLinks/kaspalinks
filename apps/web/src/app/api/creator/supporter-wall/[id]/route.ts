import { prisma } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.CREATOR_PROFILE_UPDATE, guard.creator.id);
  if (!limited.allowed) return limited.response;

  // Body { hidden: boolean } toggles visibility. A missing / non-boolean value
  // defaults to hiding, so an older client that PATCHes with no body still hides.
  let hidden = true;
  const rawText = await request.text();
  if (rawText.trim().length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
    }
    if (typeof parsed === "object" && parsed !== null && "hidden" in parsed) {
      const value = (parsed as { hidden: unknown }).hidden;
      if (typeof value !== "boolean") {
        return apiError(ErrorCodes.INVALID_BODY, "`hidden` must be a boolean.", 400);
      }
      hidden = value;
    }
  }

  const { id } = await context.params;
  const paymentRequest = await prisma.paymentRequest.findFirst({
    select: {
      actionId: true,
      id: true,
      supporterHiddenAt: true,
      supporterPublic: true,
    },
    where: {
      id,
      action: {
        creatorId: guard.creator.id,
        deletedAt: null,
      },
    },
  });

  if (!paymentRequest) {
    return apiError(ErrorCodes.NOT_FOUND, "Supporter wall entry not found.", 404);
  }

  if (!paymentRequest.supporterPublic) {
    return apiError(ErrorCodes.INVALID_STATE, "This payment is not public on the wall.", 409);
  }

  // Already in the requested state — no-op, return current state idempotently.
  if ((paymentRequest.supporterHiddenAt !== null) === hidden) {
    return apiJson({
      supporterWallEntry: {
        hidden,
        hiddenAt: paymentRequest.supporterHiddenAt?.toISOString() ?? null,
        id: paymentRequest.id,
      },
    });
  }

  const nextHiddenAt = hidden ? new Date() : null;
  const updated = await prisma.paymentRequest.update({
    data: { supporterHiddenAt: nextHiddenAt },
    where: { id: paymentRequest.id },
  });

  await writeAuditLog(prisma, {
    actionId: updated.actionId,
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: hidden ? "supporter_wall.entry_hidden" : "supporter_wall.entry_shown",
    ipHash: guard.ipHash,
    paymentRequestId: updated.id,
  });

  return apiJson({
    supporterWallEntry: {
      hidden,
      hiddenAt: nextHiddenAt?.toISOString() ?? null,
      id: updated.id,
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
