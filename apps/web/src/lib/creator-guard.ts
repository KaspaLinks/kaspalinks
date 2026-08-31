import type { Creator, PrismaClient } from "@kaspa-actions/db";
import { AuditActorType } from "@kaspa-actions/db";
import { validateTelegramMiniAppInitData } from "@kaspa-actions/agent";

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

type CreatorGuardOptions = {
  allowTelegramMiniApp?: boolean;
};

export async function requireCreator(
  request: Request,
  prisma: PrismaClient,
  options: CreatorGuardOptions = {},
): Promise<CreatorGuardFailure | CreatorGuardSuccess> {
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const miniAppInitData = request.headers.get("x-telegram-mini-app-init-data")?.trim() ?? "";
  if (miniAppInitData && options.allowTelegramMiniApp) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
    if (!botToken) {
      return {
        ok: false,
        response: apiError(ErrorCodes.SERVER_ERROR, "Telegram Mini App is unavailable.", 503),
      };
    }
    const validation = validateTelegramMiniAppInitData(miniAppInitData, botToken);
    if (!validation.ok) {
      await writeAuditLog(prisma, {
        actorType: AuditActorType.CREATOR,
        event: "creator.telegram_mini_app_auth_failed",
        ipHash,
        metadata: { reason: validation.error },
      });
      return {
        ok: false,
        response: apiError(
          ErrorCodes.CREATOR_TOKEN_INVALID,
          "Telegram Mini App authorization is invalid or expired. Reopen it from the bot.",
          401,
        ),
      };
    }

    const connection = await prisma.telegramConnection.findUnique({
      include: { creator: true },
      where: { telegramUserId: validation.identity.userId },
    });
    if (!connection?.creator.telegramBetaEnabled) {
      await writeAuditLog(prisma, {
        actorType: AuditActorType.CREATOR,
        creatorId: connection?.creatorId ?? null,
        event: "creator.telegram_mini_app_auth_failed",
        ipHash,
        metadata: { reason: connection ? "beta_disabled" : "not_connected" },
      });
      return {
        ok: false,
        response: apiError(
          ErrorCodes.CREATOR_TOKEN_INVALID,
          "This Telegram account is not connected to an enabled KaspaLinks creator.",
          401,
        ),
      };
    }

    return { creator: connection.creator, ipHash, ok: true };
  }

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
