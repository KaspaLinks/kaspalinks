import { createHash, randomBytes } from "node:crypto";

import { AuditActorType, type PrismaClient } from "@kaspa-actions/db";

import type { ActorContext } from "./actor.ts";
import { ApplicationError } from "./errors.ts";

const CONNECT_CODE_TTL_MS = 10 * 60_000;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;

export function hashTelegramConnectCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export async function createTelegramConnectCodeTool(
  prisma: PrismaClient,
  actor: ActorContext,
  now = new Date(),
) {
  const creator = await prisma.creator.findUnique({ where: { id: actor.creatorId } });
  if (!creator) throw new ApplicationError("ACTOR_NOT_FOUND", "Creator not found.", 404);
  if (!creator.telegramBetaEnabled) {
    throw new ApplicationError(
      "TELEGRAM_BETA_DISABLED",
      "Telegram beta access is not enabled.",
      403,
    );
  }

  const code = randomBytes(24).toString("base64url");
  await prisma.$transaction([
    prisma.telegramConnectCode.deleteMany({ where: { creatorId: actor.creatorId } }),
    prisma.telegramConnectCode.create({
      data: {
        codeHash: hashTelegramConnectCode(code),
        creatorId: actor.creatorId,
        expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
      },
    }),
  ]);

  return { code, expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS) };
}

async function assertTelegramConnectAttemptAllowed(
  prisma: PrismaClient,
  telegramUserId: string,
  now: Date,
) {
  const current = await prisma.telegramConnectAttempt.findUnique({
    where: { telegramUserId },
  });
  if (current?.blockedUntil && current.blockedUntil > now) {
    throw new ApplicationError("CONNECT_RATE_LIMITED", "Too many connection attempts.", 429);
  }
}

async function recordFailedTelegramConnectAttempt(
  prisma: PrismaClient,
  telegramUserId: string,
  now: Date,
) {
  const current = await prisma.telegramConnectAttempt.findUnique({ where: { telegramUserId } });
  const reset = !current || now.getTime() - current.windowStartedAt.getTime() >= ATTEMPT_WINDOW_MS;
  const attempts = reset ? 1 : current.attempts + 1;
  await prisma.telegramConnectAttempt.upsert({
    create: {
      attempts,
      blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + ATTEMPT_WINDOW_MS) : null,
      telegramUserId,
      windowStartedAt: now,
    },
    update: {
      attempts,
      blockedUntil: attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + ATTEMPT_WINDOW_MS) : null,
      ...(reset ? { windowStartedAt: now } : {}),
    },
    where: { telegramUserId },
  });
}

export async function consumeTelegramConnectCodeTool(
  prisma: PrismaClient,
  input: { code: string; telegramChatId: string; telegramUserId: string },
  now = new Date(),
) {
  await assertTelegramConnectAttemptAllowed(prisma, input.telegramUserId, now);
  const codeHash = hashTelegramConnectCode(input.code);
  const code = await prisma.telegramConnectCode.findUnique({
    include: { creator: true },
    where: { codeHash },
  });

  if (!code || code.consumedAt || code.expiresAt <= now || !code.creator.telegramBetaEnabled) {
    await recordFailedTelegramConnectAttempt(prisma, input.telegramUserId, now);
    throw new ApplicationError(
      "CONNECT_CODE_INVALID",
      "Connection code is invalid or expired.",
      400,
    );
  }

  return prisma.$transaction(async (tx) => {
    const alreadyLinked = await tx.telegramConnection.findUnique({
      where: { telegramUserId: input.telegramUserId },
    });
    if (alreadyLinked && alreadyLinked.creatorId !== code.creatorId) {
      throw new ApplicationError(
        "TELEGRAM_ALREADY_CONNECTED",
        "This Telegram account is already connected to another Creator.",
        409,
      );
    }

    const consumed = await tx.telegramConnectCode.updateMany({
      data: { consumedAt: now },
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
    });
    if (consumed.count !== 1) {
      throw new ApplicationError("CONNECT_CODE_INVALID", "Connection code was already used.", 409);
    }

    const connection = await tx.telegramConnection.upsert({
      create: {
        creatorId: code.creatorId,
        telegramChatId: input.telegramChatId,
        telegramUserId: input.telegramUserId,
      },
      update: {
        blockedAt: null,
        disabledReason: null,
        notificationsEnabled: false,
        telegramChatId: input.telegramChatId,
        telegramUserId: input.telegramUserId,
      },
      where: { creatorId: code.creatorId },
    });

    await tx.telegramConnectCode.deleteMany({ where: { creatorId: code.creatorId } });
    await tx.telegramConnectAttempt.deleteMany({ where: { telegramUserId: input.telegramUserId } });
    await tx.auditLog.create({
      data: {
        actorType: AuditActorType.CREATOR,
        creatorId: code.creatorId,
        event: "agent.telegram_connected",
      },
    });
    return { connection, creator: code.creator };
  });
}

export async function disconnectTelegramTool(prisma: PrismaClient, actor: ActorContext) {
  return prisma.$transaction(async (tx) => {
    await tx.telegramConnectCode.deleteMany({ where: { creatorId: actor.creatorId } });
    const deleted = await tx.telegramConnection.deleteMany({
      where: { creatorId: actor.creatorId },
    });
    return deleted.count > 0;
  });
}
