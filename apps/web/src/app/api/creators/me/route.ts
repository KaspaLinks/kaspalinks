import { AuditActorType, Prisma, prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { serializeSafeCreator } from "@/lib/creator-auth";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { formatZodErrorMessage, updateCreatorProfileInputSchema } from "@/lib/schemas";

const deleteCreatorBodySchema = z.object({
  confirmUsername: z.string().trim().min(1).max(64),
});

const TERMINAL_CLAIMABLE_STATUSES = ["claimed", "refunded", "spent_unknown"];

/**
 * Permanently delete the signed-in creator and everything they own.
 *
 * Privacy posture: hard delete (not soft delete). The Creator row, every
 * Action they ever created, and every PaymentRequest under those Actions
 * are removed. Security AuditLog rows are intentionally preserved with
 * SetNull foreign keys so event timestamps, IP hashes, and already-recorded
 * non-secret metadata remain available for abuse investigation.
 *
 * Confirmation: the body must include the exact username the caller is
 * authenticated as. This is intent-confirmation, not security — the
 * caller already proved possession of the creator token. The username
 * step exists so a misclicked button can't wipe a profile.
 *
 * Cascade order is manual because the Action → PaymentRequest relation
 * is `onDelete: Restrict` (Prisma refuses to delete an Action that still
 * has receipts pointing at it). The transaction deletes from the leaf
 * outward: PaymentRequests first, then Actions, then the Creator.
 */
export async function DELETE(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.CREATOR_PROFILE_DELETE, guard.creator.id);
  if (!limited.allowed) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "creator.profile_delete_rate_limited",
      ipHash: guard.ipHash,
      metadata: { bucket: RateBuckets.CREATOR_PROFILE_DELETE },
    });
    return limited.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = deleteCreatorBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

  const supplied = parsed.data.confirmUsername.trim().toLowerCase();
  if (supplied !== guard.creator.username.toLowerCase()) {
    // Intent-confirmation failure — distinct from auth failure. Log it so
    // we can spot UI bugs or scripted "delete everything" abuse attempts.
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "creator.delete_mismatch",
      ipHash: guard.ipHash,
      metadata: { suppliedUsername: supplied },
    });
    return apiError(
      ErrorCodes.INVALID_BODY,
      "Confirmation username does not match the signed-in creator.",
      400,
    );
  }

  // Claimable-link metadata is part of the non-custodial recovery path. The
  // Creator relation cascades on delete, so removing the profile while an
  // output may still be unspent would make the normal claim/refund UI lose its
  // server-side registration. Require the creator to close funded links or
  // explicitly remove verified-unfunded drafts from My Links first.
  const openClaimable = await prisma.claimableLink.findFirst({
    select: { id: true, status: true },
    where: {
      creatorId: guard.creator.id,
      deletedAt: null,
      status: { notIn: TERMINAL_CLAIMABLE_STATUSES },
    },
  });
  if (openClaimable) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "creator.delete_blocked_open_claimable",
      ipHash: guard.ipHash,
      metadata: { claimableStatus: openClaimable.status },
    });
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Close or remove every open claimable link before deleting your profile. An open claimable link may still hold KAS.",
      409,
    );
  }

  // Write the audit log entry BEFORE deletion so the creatorId reference
  // is valid. Prisma's SetNull cascade will clear that foreign key when
  // the Creator gets dropped a few lines down; the audit event itself stays.
  const actionIds = await prisma.action
    .findMany({ select: { id: true }, where: { creatorId: guard.creator.id } })
    .then((rows) => rows.map((row) => row.id));

  const deletedPaymentRequestCount =
    actionIds.length > 0
      ? await prisma.paymentRequest.count({ where: { actionId: { in: actionIds } } })
      : 0;

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "creator.deleted",
    ipHash: guard.ipHash,
    metadata: {
      deletedActionCount: actionIds.length,
      deletedPaymentRequestCount,
      username: guard.creator.username,
    },
  });

  await prisma.$transaction(async (tx) => {
    if (actionIds.length > 0) {
      // Restrict cascade — must wipe PaymentRequests before their Actions.
      await tx.paymentRequest.deleteMany({ where: { actionId: { in: actionIds } } });
      await tx.action.deleteMany({ where: { id: { in: actionIds } } });
    }
    await tx.creator.delete({ where: { id: guard.creator.id } });
  });

  return apiJson({
    deletedActionCount: actionIds.length,
    deletedPaymentRequestCount,
    ok: true,
  });
}

/**
 * Update profile-facing creator fields — bio, display name, and which
 * Action backs the quick-tip card on /u/<username>.
 *
 * Partial updates: any field omitted from the body is left untouched.
 * Sending `tipActionId: null` explicitly clears the quick-tip card (the
 * creator can drop it entirely from their profile).
 *
 * tipActionId validation: must point to an Action the caller actually
 * owns, and one that isn't soft-deleted. We don't gate on disabled /
 * expired here — the profile page itself renders an unavailable state
 * for those, and the creator might be in the middle of re-enabling.
 */
export async function PATCH(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.CREATOR_PROFILE_UPDATE, guard.creator.id);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = updateCreatorProfileInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

  const data = parsed.data;
  if (Object.keys(data).length === 0) {
    return apiError(ErrorCodes.INVALID_BODY, "At least one field must be provided.", 400);
  }

  // tipActionId can be: undefined (leave alone), null (clear), or a
  // string id (set). Only validate ownership for the string case.
  if (typeof data.tipActionId === "string") {
    const owned = await prisma.action.findFirst({
      select: { id: true },
      where: {
        creatorId: guard.creator.id,
        deletedAt: null,
        id: data.tipActionId,
      },
    });
    if (!owned) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "tipActionId must reference one of your active Actions.",
        400,
      );
    }
  }

  const updated = await prisma.creator.update({
    data: {
      ...(data.bio !== undefined ? { bio: data.bio } : {}),
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.socialLinks !== undefined
        ? { socialLinks: data.socialLinks === null ? Prisma.DbNull : data.socialLinks }
        : {}),
      ...(data.tipActionId !== undefined ? { tipActionId: data.tipActionId } : {}),
    },
    where: { id: guard.creator.id },
  });

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "creator.profile_updated",
    ipHash: guard.ipHash,
    metadata: {
      fields: Object.keys(data),
    },
  });

  return apiJson({ creator: serializeSafeCreator(updated) });
}

const methodNotAllowed = () => apiMethodNotAllowed(["DELETE", "PATCH"]);

export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT };
