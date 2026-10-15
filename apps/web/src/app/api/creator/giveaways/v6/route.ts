import { createHash } from "node:crypto";

import {
  AuditActorType,
  GiveawayStatus,
  GiveawayV6BootstrapStatus,
  GiveawayV6Phase,
  Network,
  prisma,
} from "@kaspa-actions/db";
import { buildKaspaPaymentUri, formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { parseGiveawayV6ConfigJson } from "@kaspa-actions/kaspa-indexer";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  buildGiveawayV6CreationTerms,
  createGiveawayV6InputSchema,
  isGiveawayV6CreationEnabled,
} from "@/lib/giveaway-v6-creation";
import { compileGiveawayV6Bootstrap, GiveawayV6CompilerError } from "@/lib/giveaway-v6-compiler";
import { GiveawayV6SlotClosedError, resolveGiveawayV6DrawSlot } from "@/lib/giveaway-v6-slot-store";
import { checkGiveawayV6Slot, describeGiveawayV6SlotCheck } from "@/lib/giveaway-v6-slots";
import { readCurrentMainnetChainPosition } from "@/lib/mainnet-chain-position";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export const runtime = "nodejs";

export async function GET(request: Request) {
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

  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_FUNDING_STATUS, guard.creator.id);
  if (!limited.allowed) return limited.response;

  let giveaways: Awaited<ReturnType<typeof loadCreatorGiveaways>>;
  try {
    giveaways = await loadCreatorGiveaways(guard.creator.id);
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Giveaways could not be loaded.", 503);
  }

  return apiJson({
    giveaways: giveaways.flatMap((giveaway) => {
      const bootstrap = giveaway.v6Bootstrap;
      if (!bootstrap) return [];
      let participantCap: number;
      try {
        const config = parseGiveawayV6ConfigJson(bootstrap.config);
        participantCap = config.shardCount * config.maxEntriesPerShard;
      } catch {
        return [];
      }
      const phase = giveaway.v6Projection?.phase ?? GiveawayV6Phase.AWAITING_ACTIVATION;
      return [
        {
          activation: {
            activateUrl:
              bootstrap.status === GiveawayV6BootstrapStatus.BOUND
                ? `/api/creator/giveaways/v6/${giveaway.publicId}/activation`
                : null,
            submittedAt: bootstrap.activationSubmittedAt?.toISOString() ?? null,
            transactionId: bootstrap.activationTransactionId,
          },
          amountKas: formatSompiToKaspa(giveaway.amountSompi),
          closesAt: giveaway.closesAt.toISOString(),
          createdAt: giveaway.createdAt.toISOString(),
          description: giveaway.description,
          funding: {
            address: bootstrap.fundingAddress,
            amountKas: formatSompiToKaspa(bootstrap.expectedFundingSompi),
            amountSompi: bootstrap.expectedFundingSompi.toString(),
            paymentUri: buildKaspaPaymentUri({
              amountSompi: bootstrap.expectedFundingSompi,
              label: "Kaspa Links Giveaway",
              message: giveaway.title,
              recipientAddress: bootstrap.fundingAddress,
            }),
            status: bootstrap.status,
          },
          participantCap,
          phase,
          publicId: giveaway.publicId,
          publicUrl: `/giveaways/${giveaway.publicId}`,
          registrationCount: giveaway.v6Projection?.observedRegistrationCount ?? 0,
          frozenEntryCount: giveaway.v6Projection?.frozenEntryCount ?? null,
          shareReady: phase !== GiveawayV6Phase.AWAITING_ACTIVATION,
          terminalTransactionId: giveaway.v6Projection?.terminalTransactionId ?? null,
          title: giveaway.title,
          winnerScriptPublicKeyHex: giveaway.v6Projection?.winnerScriptPublicKeyHex ?? null,
        },
      ];
    }),
  });
}

function loadCreatorGiveaways(creatorId: string) {
  return prisma.giveaway.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      amountSompi: true,
      closesAt: true,
      createdAt: true,
      description: true,
      publicId: true,
      title: true,
      v6Bootstrap: {
        select: {
          activationSubmittedAt: true,
          activationTransactionId: true,
          config: true,
          expectedFundingSompi: true,
          fundingAddress: true,
          status: true,
        },
      },
      v6Projection: {
        select: {
          frozenEntryCount: true,
          observedRegistrationCount: true,
          phase: true,
          terminalTransactionId: true,
          winnerScriptPublicKeyHex: true,
        },
      },
    },
    take: 20,
    where: { creatorId, drawProtocolVersion: 6 },
  });
}

export async function POST(request: Request) {
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

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = createGiveawayV6InputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid Giveaway V6 terms.",
      400,
    );
  }

  const closesAt = parsed.data.slotStartsAt;
  const slotCheck = checkGiveawayV6Slot(closesAt, new Date());
  if (slotCheck !== "ok") {
    return apiError(ErrorCodes.INVALID_BODY, describeGiveawayV6SlotCheck(slotCheck), 400);
  }

  let chain: Awaited<ReturnType<typeof readCurrentMainnetChainPosition>>;
  try {
    chain = await readCurrentMainnetChainPosition();
  } catch {
    return apiError(
      ErrorCodes.UPSTREAM_TIMEOUT,
      "The current Kaspa Mainnet position is temporarily unavailable.",
      503,
    );
  }
  const chainReadAt = new Date();

  let slot: Awaited<ReturnType<typeof resolveGiveawayV6DrawSlot>>;
  try {
    slot = await resolveGiveawayV6DrawSlot(prisma, {
      network: Network.MAINNET,
      startsAt: closesAt,
      chain,
      now: chainReadAt,
    });
  } catch (error) {
    if (error instanceof GiveawayV6SlotClosedError) {
      return apiError(ErrorCodes.INVALID_BODY, error.message, 400);
    }
    return apiError(ErrorCodes.SERVER_ERROR, "The draw time could not be reserved.", 503);
  }

  let terms: ReturnType<typeof buildGiveawayV6CreationTerms>;
  try {
    terms = buildGiveawayV6CreationTerms({ slot, request: parsed.data });
  } catch (error) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      error instanceof Error ? error.message : "Invalid Giveaway V6 terms.",
      400,
    );
  }

  let bootstrap: Awaited<ReturnType<typeof compileGiveawayV6Bootstrap>>;
  try {
    bootstrap = await compileGiveawayV6Bootstrap({
      network: Network.MAINNET,
      config: terms.config,
      economics: terms.economics,
    });
  } catch (error) {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      error instanceof GiveawayV6CompilerError
        ? "The reviewed SilverScript compiler is temporarily unavailable."
        : "Giveaway V6 could not be prepared.",
      503,
    );
  }
  if (bootstrap.expectedFundingSompi !== terms.expectedFundingSompi) {
    return apiError(ErrorCodes.SERVER_ERROR, "Giveaway V6 funding review did not match.", 503);
  }

  const compatibilityCommitment = createHash("sha256")
    .update(`kaspa-links-giveaway-v6\n${terms.config.giveawayIdHex}`, "utf8")
    .digest("hex");

  let giveaway: { createdAt: Date; publicId: string };
  try {
    giveaway = await prisma.$transaction(async (transaction) => {
      // One nested Prisma write makes the public giveaway and its reviewed
      // pre-funding contract inseparable. A QR is returned only afterwards.
      const created = await transaction.giveaway.create({
        data: {
          amountSompi: terms.economics.prizeValueSompi,
          closesAt,
          creatorId: guard.creator.id,
          description: terms.description,
          drawCommitment: compatibilityCommitment,
          drawProtocolVersion: 6,
          drawSeedHex: terms.config.giveawayIdHex,
          entropyTargetBlueScore: terms.config.entropyTargetBlueScore,
          entryWindowSeconds: Math.round((closesAt.getTime() - chainReadAt.getTime()) / 1_000),
          openedAt: null,
          status: GiveawayStatus.OPEN,
          title: terms.title,
          v6Bootstrap: { create: bootstrap },
        },
        select: { createdAt: true, publicId: true },
      });
      await writeAuditLog(transaction, {
        actorType: AuditActorType.CREATOR,
        creatorId: guard.creator.id,
        event: "giveaway.v6_created",
        ipHash: guard.ipHash,
        metadata: {
          closesAtDaa: terms.config.closesAtDaa.toString(),
          expectedFundingSompi: bootstrap.expectedFundingSompi.toString(),
          participantCap: terms.participantCap,
          publicId: created.publicId,
          returnAtDaa: terms.config.returnAtDaa.toString(),
        },
      });
      return created;
    });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Giveaway V6 could not be saved.", 503);
  }

  const paymentUri = buildKaspaPaymentUri({
    amountSompi: bootstrap.expectedFundingSompi,
    label: "Kaspa Links Giveaway",
    message: terms.title,
    recipientAddress: bootstrap.fundingAddress,
  });

  return apiJson(
    {
      giveaway: {
        amountKas: terms.amountKas,
        closesAt: closesAt.toISOString(),
        createdAt: giveaway.createdAt.toISOString(),
        description: terms.description,
        participantCap: terms.participantCap,
        publicId: giveaway.publicId,
        publicUrl: `/giveaways/${giveaway.publicId}`,
        shareReady: false,
        status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
        title: terms.title,
      },
      funding: {
        address: bootstrap.fundingAddress,
        amountKas: formatSompiToKaspa(bootstrap.expectedFundingSompi),
        amountSompi: bootstrap.expectedFundingSompi.toString(),
        breakdown: {
          activationFeeSompi: terms.economics.activationFeeSompi.toString(),
          executionReserveSompi: terms.executionReserveSompi.toString(),
          maximumEntryFeesSompi: terms.maximumEntryFeesSompi.toString(),
          maximumNetworkCostSompi: terms.maximumNetworkCostSompi.toString(),
          minimumReturnSompi: terms.minimumReturnSompi.toString(),
          prizeSompi: terms.economics.prizeValueSompi.toString(),
          settlementFeesSompi: terms.settlementFeesSompi.toString(),
        },
        network: "mainnet",
        paymentUri,
        unusedReserveReturnAddress: parsed.data.returnAddress,
      },
      review: {
        closesAtDaa: terms.config.closesAtDaa.toString(),
        compilerCommit: bootstrap.compilerCommit,
        entropyTargetBlueScore: terms.config.entropyTargetBlueScore.toString(),
        prizeSourceSha256: bootstrap.prizeSourceSha256,
        returnAtDaa: terms.config.returnAtDaa.toString(),
        shardCount: terms.config.shardCount,
        shardSourceSha256: bootstrap.shardSourceSha256,
      },
    },
    201,
  );
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "POST"]);
export { methodNotAllowed as DELETE, methodNotAllowed as PATCH, methodNotAllowed as PUT };
