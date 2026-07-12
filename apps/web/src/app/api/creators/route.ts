import { prisma } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import {
  generateCreatorToken,
  hashCreatorToken,
  isCreatorSignupEnabled,
  serializeSafeCreator,
} from "@/lib/creator-auth";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { createCreatorInputSchema, formatZodErrorMessage } from "@/lib/schemas";

export async function POST(request: Request) {
  const ipHash = hashClientIp(extractClientIp(request.headers));

  const limited = enforceRateLimit(RateBuckets.CREATOR_SIGNUP, ipHash);
  if (!limited.allowed) return limited.response;

  if (!isCreatorSignupEnabled()) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      event: "creator.signup_disabled",
      ipHash,
    });

    return apiError(
      ErrorCodes.CREATOR_SIGNUP_DISABLED,
      "Creator signup is disabled on this deployment.",
      403,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = createCreatorInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

  const existing = await prisma.creator.findUnique({ where: { username: parsed.data.username } });
  if (existing) {
    return apiError(ErrorCodes.USERNAME_TAKEN, "Username is already taken.", 409);
  }

  const creatorToken = generateCreatorToken();
  let creator;
  try {
    creator = await prisma.creator.create({
      data: {
        displayName: parsed.data.displayName,
        tokenHash: hashCreatorToken(creatorToken),
        username: parsed.data.username,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error, ["username"])) {
      return apiError(ErrorCodes.USERNAME_TAKEN, "Username is already taken.", 409);
    }

    throw error;
  }

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: creator.id,
    event: "creator.created",
    ipHash,
    metadata: { username: creator.username },
  });

  return apiJson(
    {
      creator: serializeSafeCreator(creator),
      creatorToken,
    },
    201,
  );
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
