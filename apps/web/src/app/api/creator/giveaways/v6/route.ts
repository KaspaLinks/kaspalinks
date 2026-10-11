import { createHash } from "node:crypto";

import {
  AuditActorType,
  GiveawayStatus,
  GiveawayV6BootstrapStatus,
  Network,
  prisma,
} from "@kaspa-actions/db";
import { buildKaspaPaymentUri, formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  buildGiveawayV6CreationTerms,
  createGiveawayV6InputSchema,
  isGiveawayV6CreationEnabled,
} from "@/lib/giveaway-v6-creation";
import {
  compileGiveawayV6Bootstrap,
  GiveawayV6CompilerError,
} from "@/lib/giveaway-v6-compiler";
import { readCurrentMainnetChainPosition } from "@/lib/mainnet-chain-position";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

export const runtime = "nodejs";

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

  let terms: ReturnType<typeof buildGiveawayV6CreationTerms>;
  try {
    terms = buildGiveawayV6CreationTerms({ chain, request: parsed.data });
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

  const closesAt = new Date(chainReadAt.getTime() + parsed.data.durationSeconds * 1_000);
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
          entryWindowSeconds: parsed.data.durationSeconds,
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
          prizeSompi: terms.economics.prizeValueSompi.toString(),
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

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
