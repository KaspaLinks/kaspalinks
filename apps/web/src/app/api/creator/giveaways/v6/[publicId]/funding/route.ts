import {
  GiveawayV6BootstrapError,
  persistGiveawayV6BootstrapBinding,
  prepareGiveawayV6BootstrapBinding,
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
import { giveawayV6AccessFor, isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";
import { readGiveawayV6ConfirmedFunding } from "@/lib/giveaway-v6-funding";
import { giveawayPublicIdSchema } from "@/lib/giveaway-lab";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

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
  if (!giveawayV6AccessFor(guard.creator)) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway V6 access is not enabled.", 404);
  }

  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, guard.creator.id);
  if (!limited.allowed) return limited.response;

  const { publicId } = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  let giveaway = await loadOwnedGiveaway(guard.creator.id, parsedId.data);
  if (!giveaway?.v6Bootstrap) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  }
  if (giveaway.v6Bootstrap.status === GiveawayV6BootstrapStatus.BOUND) {
    return boundResponse(giveaway);
  }

  let lookup: Awaited<ReturnType<typeof readGiveawayV6ConfirmedFunding>>;
  try {
    lookup = await readGiveawayV6ConfirmedFunding({
      expectedFundingSompi: giveaway.v6Bootstrap.expectedFundingSompi,
      fundingAddress: giveaway.v6Bootstrap.fundingAddress,
      fundingScriptPublicKeyHex: giveaway.v6Bootstrap.fundingScriptPublicKeyHex,
    });
  } catch {
    return apiError(
      ErrorCodes.UPSTREAM_TIMEOUT,
      "Giveaway funding could not be verified on Kaspa Mainnet.",
      503,
    );
  }

  if (lookup.status !== "confirmed") {
    return apiJson({
      activation: { status: GiveawayV6Phase.AWAITING_ACTIVATION },
      funding: {
        address: giveaway.v6Bootstrap.fundingAddress,
        amountSompi: giveaway.v6Bootstrap.expectedFundingSompi.toString(),
        confirmationPending: lookup.status === "pending",
        status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
      },
      giveaway: { publicId: giveaway.publicId, shareReady: false },
    });
  }

  let prepared: ReturnType<typeof prepareGiveawayV6BootstrapBinding>;
  try {
    prepared = prepareGiveawayV6BootstrapBinding({
      funding: lookup.funding,
      record: giveaway.v6Bootstrap,
    });
    await persistGiveawayV6BootstrapBinding(prisma, giveaway.v6Bootstrap, prepared);
  } catch (error) {
    if (error instanceof GiveawayV6BootstrapError && error.code === "STALE_BOOTSTRAP") {
      giveaway = await loadOwnedGiveaway(guard.creator.id, parsedId.data);
      if (giveaway?.v6Bootstrap?.status === GiveawayV6BootstrapStatus.BOUND) {
        return boundResponse(giveaway);
      }
    }
    return apiError(ErrorCodes.SERVER_ERROR, "Giveaway funding could not be bound safely.", 503);
  }

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "giveaway.v6_funding_bound",
    ipHash: guard.ipHash,
    metadata: {
      covenantIdHex: prepared.family.covenantIdHex,
      fundingOutputIndex: lookup.funding.outputIndex,
      fundingTransactionId: lookup.funding.transactionId,
      publicId: giveaway.publicId,
    },
  });

  return apiJson({
    activation: {
      activateUrl: `/api/creator/giveaways/v6/${giveaway.publicId}/activation`,
      covenantIdHex: prepared.family.covenantIdHex,
      status: GiveawayV6Phase.AWAITING_ACTIVATION,
    },
    funding: {
      acceptingBlockHash: lookup.funding.acceptingBlockHash,
      blockDaaScore: lookup.funding.blockDaaScore.toString(),
      outputIndex: lookup.funding.outputIndex,
      status: GiveawayV6BootstrapStatus.BOUND,
      transactionId: lookup.funding.transactionId,
    },
    giveaway: { publicId: giveaway.publicId, shareReady: false },
  });
}

async function loadOwnedGiveaway(creatorId: string, publicId: string) {
  return prisma.giveaway.findFirst({
    select: {
      publicId: true,
      v6Bootstrap: {
        select: {
          compilerCommit: true,
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
          config: true,
        },
      },
      v6Projection: { select: { phase: true } },
    },
    where: { creatorId, drawProtocolVersion: 6, publicId },
  });
}

function boundResponse(giveaway: OwnedGiveaway): Response {
  const bootstrap = giveaway.v6Bootstrap;
  if (
    !bootstrap ||
    !bootstrap.covenantIdHex ||
    !bootstrap.fundingAcceptingBlockHash ||
    bootstrap.fundingBlockDaaScore === null ||
    bootstrap.fundingOutputIndex === null ||
    !bootstrap.fundingTransactionId ||
    !giveaway.v6Projection
  ) {
    return apiError(ErrorCodes.SERVER_ERROR, "Bound Giveaway V6 state is incomplete.", 503);
  }
  return apiJson({
    activation: {
      activateUrl: `/api/creator/giveaways/v6/${giveaway.publicId}/activation`,
      covenantIdHex: bootstrap.covenantIdHex,
      status: giveaway.v6Projection.phase,
    },
    funding: {
      acceptingBlockHash: bootstrap.fundingAcceptingBlockHash,
      blockDaaScore: bootstrap.fundingBlockDaaScore.toString(),
      outputIndex: bootstrap.fundingOutputIndex,
      status: GiveawayV6BootstrapStatus.BOUND,
      transactionId: bootstrap.fundingTransactionId,
    },
    giveaway: {
      publicId: giveaway.publicId,
      shareReady: giveaway.v6Projection.phase !== GiveawayV6Phase.AWAITING_ACTIVATION,
    },
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
