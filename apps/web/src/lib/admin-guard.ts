import type { PrismaClient } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";

import { verifyAdminRequest } from "./admin-auth";
import { writeAuditLog } from "./audit";
import { extractClientIp, hashClientIp } from "./client-ip";
import { apiError, ErrorCodes } from "./errors";

export type AdminGuardSuccess = {
  ipHash: string;
  ok: true;
};

export type AdminGuardFailure = {
  ok: false;
  response: Response;
};

export async function requireAdmin(
  request: Request,
  prisma: PrismaClient,
  context: { event: string; metadata?: Record<string, unknown> } = { event: "admin.token_failed" },
): Promise<AdminGuardFailure | AdminGuardSuccess> {
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const result = verifyAdminRequest(request.headers);

  if (result.ok) {
    return { ipHash, ok: true };
  }

  if (result.reason === "disabled") {
    return {
      ok: false,
      response: apiError(
        ErrorCodes.ADMIN_DISABLED,
        "Admin access is not configured on this deployment.",
        503,
      ),
    };
  }

  await writeAuditLog(prisma, {
    actorType: AuditActorType.ADMIN,
    event: context.event,
    ipHash,
    metadata: { ...context.metadata, reason: result.reason },
  });

  if (result.reason === "missing") {
    return {
      ok: false,
      response: apiError(
        ErrorCodes.ADMIN_TOKEN_REQUIRED,
        "Admin token is required (x-admin-token header or Authorization: Bearer).",
        401,
      ),
    };
  }

  return {
    ok: false,
    response: apiError(ErrorCodes.ADMIN_TOKEN_INVALID, "Admin token is invalid.", 401),
  };
}
