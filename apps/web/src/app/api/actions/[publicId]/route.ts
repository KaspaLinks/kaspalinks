import { prisma } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";

import {
  isActionDeleted,
  isActionDisabled,
  isActionExpired,
  serializePublicAction,
} from "@/lib/action-serializer";
import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { publicId } = await context.params;
  const ipHash = hashClientIp(extractClientIp(request.headers));

  const action = await prisma.action.findUnique({ where: { publicId } });
  if (!action || isActionDeleted(action)) {
    return apiError(ErrorCodes.NOT_FOUND, "Action not found.", 404);
  }

  if (isActionDisabled(action)) {
    await writeAuditLog(prisma, {
      actionId: action.id,
      actorType: AuditActorType.PUBLIC,
      event: "action.public_metadata_disabled",
      ipHash,
      metadata: { publicId: action.publicId },
    });
    return apiError(ErrorCodes.ACTION_DISABLED, "Action is disabled.", 403);
  }

  if (isActionExpired(action)) {
    await writeAuditLog(prisma, {
      actionId: action.id,
      actorType: AuditActorType.PUBLIC,
      event: "action.public_metadata_expired",
      ipHash,
      metadata: { publicId: action.publicId },
    });
    return apiError(ErrorCodes.ACTION_EXPIRED, "Action has expired.", 410);
  }

  return apiJson({ action: serializePublicAction(action) });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
