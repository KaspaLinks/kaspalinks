import {
  buildGiveawayV6ActivationTransaction,
  persistGiveawayV6ActivationFailure,
  persistGiveawayV6ActivationPlan,
  persistGiveawayV6ActivationSubmitted,
} from "@kaspa-actions/application";
import {
  AuditActorType,
  GiveawayV6BootstrapStatus,
  GiveawayV6Phase,
  prisma,
} from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";
import { giveawayPublicIdSchema } from "@/lib/giveaway-lab";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { broadcastToccataGiveawayV6ActivationTransaction } from "@/lib/toccata-lab";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ publicId: string }> };
type OwnedGiveaway = NonNullable<Awaited<ReturnType<typeof loadOwnedGiveaway>>>;

export async function POST(request: Request, context: RouteContext) {
  if (!isGiveawayV6CreationEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway V6 creation is disabled.", 404);
  }

  const guard = await requireCreator(request, prisma, {
    allowTelegramMiniApp: true,
    allowTelegramOnly: true,
  });
  if (!guard.ok) return guard.response;
  if (!guard.creator.prizeCovenantEnabled) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway V6 access is not enabled.", 404);
  }

  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, guard.creator.id);
  if (!limited.allowed) return limited.response;

  const { publicId } = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const giveaway = await loadOwnedGiveaway(guard.creator.id, parsedId.data);
  if (!giveaway?.v6Bootstrap || !giveaway.v6Projection) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  }
  if (giveaway.v6Projection.phase !== GiveawayV6Phase.AWAITING_ACTIVATION) {
    return activationResponse(giveaway, "CONFIRMED");
  }
  if (giveaway.v6Bootstrap.status !== GiveawayV6BootstrapStatus.BOUND) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Giveaway funding must confirm before activation.",
      409,
    );
  }

  let activation: ReturnType<typeof buildGiveawayV6ActivationTransaction>;
  try {
    activation = buildGiveawayV6ActivationTransaction(giveaway.v6Bootstrap);
    await persistGiveawayV6ActivationPlan(prisma, giveaway.v6Bootstrap, activation.transactionId);
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Giveaway activation could not be reconstructed safely.",
      503,
    );
  }

  if (giveaway.v6Bootstrap.activationSubmittedAt !== null) {
    return activationResponse(giveaway, "SUBMITTED", activation.transactionId);
  }

  const attemptedAt = new Date();
  let submittedTransactionId: string;
  try {
    const submitted = await broadcastToccataGiveawayV6ActivationTransaction({
      expectedTransactionId: activation.transactionId,
      transactionSafeJson: activation.transactionSafeJson,
    });
    submittedTransactionId = submitted.submittedTransactionId;
  } catch (error) {
    if (isAlreadyAccepted(error)) {
      submittedTransactionId = activation.transactionId;
    } else {
      const errorCode = isRelayRejection(error)
        ? "ACTIVATION_RELAY_REJECTED"
        : "ACTIVATION_RELAY_UNAVAILABLE";
      await persistGiveawayV6ActivationFailure(
        prisma,
        giveaway.v6Bootstrap,
        activation.transactionId,
        attemptedAt,
        errorCode,
      ).catch(() => undefined);
      return apiError(
        ErrorCodes.UPSTREAM_TIMEOUT,
        "Giveaway activation could not be submitted. Retrying is safe.",
        503,
      );
    }
  }

  if (submittedTransactionId.toLowerCase() !== activation.transactionId) {
    await persistGiveawayV6ActivationFailure(
      prisma,
      giveaway.v6Bootstrap,
      activation.transactionId,
      attemptedAt,
      "ACTIVATION_RELAY_REJECTED",
    ).catch(() => undefined);
    return apiError(ErrorCodes.SERVER_ERROR, "Kaspa returned an unexpected transaction ID.", 503);
  }

  try {
    await persistGiveawayV6ActivationSubmitted(
      prisma,
      giveaway.v6Bootstrap,
      activation.transactionId,
      attemptedAt,
    );
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "giveaway.v6_activation_submitted",
      ipHash: guard.ipHash,
      metadata: {
        covenantIdHex: activation.covenantIdHex,
        publicId: giveaway.publicId,
        transactionId: activation.transactionId,
      },
    });
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Giveaway activation was submitted but its retry state could not be saved.",
      503,
    );
  }

  return activationResponse(giveaway, "SUBMITTED", activation.transactionId);
}

async function loadOwnedGiveaway(creatorId: string, publicId: string) {
  return prisma.giveaway.findFirst({
    select: {
      publicId: true,
      v6Bootstrap: {
        select: {
          activationOutputs: true,
          activationSubmittedAt: true,
          activationTransactionId: true,
          compilerCommit: true,
          config: true,
          covenantIdHex: true,
          expectedFundingSompi: true,
          familyTerms: true,
          fundingAcceptingBlockHash: true,
          fundingAddress: true,
          fundingBlockDaaScore: true,
          fundingOutputIndex: true,
          fundingScriptPublicKeyHex: true,
          fundingTransactionId: true,
          giveawayId: true,
          id: true,
          network: true,
          prizeRedeemScriptHex: true,
          prizeSourceSha256: true,
          shardSourceSha256: true,
          shardTemplateRedeemScriptHex: true,
          status: true,
        },
      },
      v6Projection: { select: { phase: true } },
    },
    where: { creatorId, drawProtocolVersion: 6, publicId },
  });
}

function activationResponse(
  giveaway: OwnedGiveaway,
  deliveryStatus: "CONFIRMED" | "SUBMITTED",
  transactionId = giveaway.v6Bootstrap?.activationTransactionId ?? null,
): Response {
  return apiJson({
    activation: {
      chainStatus: giveaway.v6Projection?.phase ?? GiveawayV6Phase.AWAITING_ACTIVATION,
      deliveryStatus,
      transactionId,
    },
    giveaway: {
      publicId: giveaway.publicId,
      shareReady: giveaway.v6Projection?.phase !== GiveawayV6Phase.AWAITING_ACTIVATION,
    },
  });
}

function isAlreadyAccepted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /already (?:accepted|known)|transaction.*already/iu.test(message);
}

function isRelayRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /rejected transaction|invalid transaction/iu.test(message);
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
