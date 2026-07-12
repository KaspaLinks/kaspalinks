import { prisma } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { serializeSafeCreator, verifyCreatorToken } from "@/lib/creator-auth";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { creatorLoginInputSchema, formatZodErrorMessage } from "@/lib/schemas";

export async function POST(request: Request) {
  const ipHash = hashClientIp(extractClientIp(request.headers));

  const limited = enforceRateLimit(RateBuckets.CREATOR_LOGIN, ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = creatorLoginInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

  const creator = await prisma.creator.findUnique({ where: { username: parsed.data.username } });
  if (!creator || !verifyCreatorToken(parsed.data.token, creator.tokenHash)) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: creator?.id ?? null,
      event: "creator.login_failed",
      ipHash,
      metadata: { username: parsed.data.username },
    });

    return apiError(ErrorCodes.CREATOR_TOKEN_INVALID, "Creator token is invalid.", 401);
  }

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: creator.id,
    event: "creator.login_succeeded",
    ipHash,
    metadata: { username: creator.username },
  });

  return apiJson({ creator: serializeSafeCreator(creator) });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
