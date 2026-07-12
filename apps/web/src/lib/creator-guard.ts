import type { Creator, PrismaClient } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";

import { writeAuditLog } from "./audit";
import { extractClientIp, hashClientIp } from "./client-ip";
import { readCreatorToken, verifyCreatorToken } from "./creator-auth";
import { apiError, ErrorCodes } from "./errors";

type CreatorGuardSuccess = {
  creator: Creator;
  ipHash: string;
  ok: true;
};

type CreatorGuardFailure = {
  ok: false;
  response: Response;
};

export async function requireCreator(
  request: Request,
  prisma: PrismaClient,
): Promise<CreatorGuardFailure | CreatorGuardSuccess> {
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const username = request.headers.get("x-creator-username")?.trim().toLowerCase() ?? "";
  const token = readCreatorToken(request.headers);

  if (!username || !token) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      event: "creator.auth_failed",
      ipHash,
      metadata: { reason: !username ? "missing_username" : "missing_token", username },
    });

    return {
      ok: false,
      response: apiError(
        ErrorCodes.CREATOR_TOKEN_REQUIRED,
        "Creator username and token are required.",
        401,
      ),
    };
  }

  const creator = await prisma.creator.findUnique({ where: { username } });
  if (!creator || !verifyCreatorToken(token, creator.tokenHash)) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: creator?.id ?? null,
      event: "creator.auth_failed",
      ipHash,
      metadata: { reason: "invalid", username },
    });

    return {
      ok: false,
      response: apiError(ErrorCodes.CREATOR_TOKEN_INVALID, "Creator token is invalid.", 401),
    };
  }

  return { creator, ipHash, ok: true };
}
