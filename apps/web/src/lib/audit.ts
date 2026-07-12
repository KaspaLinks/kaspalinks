import type { PrismaClient } from "@kaspa-actions/db";
import { AuditActorType, Prisma } from "@kaspa-actions/db";

const FORBIDDEN_METADATA_KEYS = new Set([
  "accessToken",
  "adminToken",
  "authorization",
  "body",
  "key",
  "password",
  "privateKey",
  "rawBody",
  "secret",
  "seedPhrase",
  "token",
  "walletKey",
]);

export type AuditMetadata = Record<string, unknown>;

export type WriteAuditLogInput = {
  actionId?: null | string;
  actorType?: AuditActorType;
  creatorId?: null | string;
  event: string;
  ipHash?: null | string;
  metadata?: AuditMetadata;
  paymentRequestId?: null | string;
};

export function sanitizeAuditMetadata(metadata?: AuditMetadata): AuditMetadata | null {
  if (!metadata) {
    return null;
  }

  const safe: AuditMetadata = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      continue;
    }

    safe[key] = value;
  }

  return Object.keys(safe).length > 0 ? safe : null;
}

export async function writeAuditLog(
  prisma: PrismaClient,
  input: WriteAuditLogInput,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actionId: input.actionId ?? null,
      actorType: input.actorType ?? AuditActorType.SYSTEM,
      creatorId: input.creatorId ?? null,
      event: input.event,
      ipHash: input.ipHash ?? null,
      metadata: (sanitizeAuditMetadata(input.metadata) ?? undefined) as
        | Prisma.InputJsonValue
        | undefined,
      paymentRequestId: input.paymentRequestId ?? null,
    },
  });
}
