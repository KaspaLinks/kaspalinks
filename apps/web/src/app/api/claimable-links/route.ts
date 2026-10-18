import { AuditActorType, prisma } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { isClaimableAnonymousEnabled } from "@/lib/claimable-flags";
import {
  parseClaimableRegistration,
  sameImmutableClaimable,
  serializeClaimableLink,
  type ClaimableLinkRow,
} from "@/lib/claimable-registration";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { requireCreator } from "@/lib/creator-guard";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { parseSignupSource } from "@/lib/signup-source";
import { isToccataLabEnabled } from "@/lib/toccata-lab";

// Account-free registration of single claimable links (docs/adr/0007). Only the
// keyless auto-return script is accepted, because nobody holds a refund key:
// unclaimed KAS goes back to the committed return address after expiry.
// Registration stores public metadata only; the claim code never reaches us.

export async function POST(request: Request) {
  if (!isToccataLabEnabled() || !isClaimableAnonymousEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Not found.", 404);
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.CLAIMABLE_ANONYMOUS_CREATE, ipHash);
  if (!limited.allowed) return limited.response;

  // From the Telegram Mini App the link belongs to that chat's workspace, so the
  // bot can list it and say when it was claimed or returned. Still no account.
  // Without a valid workspace it stays an ordinary account-free link: anyone may
  // create those, so failed Telegram auth grants nothing and blocks nothing.
  let owner: null | { accountKind: string; id: string } = null;
  if (request.headers.get("x-telegram-mini-app-init-data")) {
    const guard = await requireCreator(request, prisma, {
      allowTelegramMiniApp: true,
      allowTelegramOnly: true,
    });
    if (guard.ok) owner = { accountKind: guard.creator.accountKind, id: guard.creator.id };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid JSON body.", 400);
  }

  const registration = parseClaimableRegistration(body, { requireAutoReturn: true });
  if (!registration.ok) {
    return apiError(registration.code, registration.message, registration.status);
  }
  const { immutableData, linkKey } = registration;

  // A retry of the same registration is idempotent; anything else is a conflict.
  const existing = await prisma.claimableLink.findUnique({ where: { linkKey } });
  if (existing) {
    if (
      existing.creatorId !== (owner?.id ?? null) ||
      !sameImmutableClaimable(existing, immutableData)
    ) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Claimable link key is already registered with different metadata.",
        409,
      );
    }
    return apiJson({ claimableLink: serializeClaimableLink(existing) });
  }

  const daily = enforceRateLimit(RateBuckets.CLAIMABLE_ANONYMOUS_DAILY, ipHash);
  if (!daily.allowed) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.PUBLIC,
      event: "claimable_link.anonymous_daily_limit",
      ipHash,
    });
    return daily.response;
  }

  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const source = parseSignupSource(fields.source);
  // Optional: the SHA-256 of a private token that lets an account adopt the link later.
  const manageTokenHash =
    typeof fields.manageTokenHash === "string" && /^[a-f0-9]{64}$/.test(fields.manageTokenHash)
      ? fields.manageTokenHash
      : null;

  let link: ClaimableLinkRow;
  try {
    link = await prisma.claimableLink.create({
      data: {
        createdWithoutAccount: owner === null || owner.accountKind !== "REGISTERED",
        creatorId: owner?.id ?? null,
        linkKey,
        ...immutableData,
        manageTokenHash,
        source,
        status: "awaiting_funding",
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error, ["linkKey"])) {
      return apiError(ErrorCodes.INVALID_STATE, "Claimable link key is already registered.", 409);
    }
    if (isPrismaUniqueConstraintError(error, ["manageTokenHash"])) {
      return apiError(ErrorCodes.INVALID_STATE, "This manage token is already in use.", 409);
    }
    throw error;
  }

  await writeAuditLog(prisma, {
    actorType: AuditActorType.PUBLIC,
    ...(owner ? { creatorId: owner.id } : {}),
    event: "claimable_link.created_anonymous",
    ipHash,
    metadata: { linkKey, source },
  });

  return apiJson({ claimableLink: serializeClaimableLink(link) }, 201);
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
