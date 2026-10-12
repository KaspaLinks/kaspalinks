import {
  buildGiveawayV6RegistrationTransaction,
  restoreGiveawayV6Projection,
} from "@kaspa-actions/application";
import { AuditActorType, GiveawayV6Phase, prisma } from "@kaspa-actions/db";
import { buildKaspaAddressScriptPublicKeyHex } from "@kaspa-actions/kaspa";
import { GiveawayV6ReconstructionError } from "@kaspa-actions/kaspa-indexer";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";
import { normalizeGiveawayAddress } from "@/lib/giveaway-lab";
import { readCurrentMainnetChainPosition } from "@/lib/mainnet-chain-position";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { publicCovenantVerificationReady, registerPublicCovenant } from "@/lib/public-covenant";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { broadcastToccataGiveawayV6RegistrationTransaction } from "@/lib/toccata-lab";
import { verifyGiveawayTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    address: z.string().trim().min(20).max(150),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();
const publicIdSchema = z.string().cuid();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const ip = extractClientIp(request.headers);
  const limit = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_ENTRY, hashClientIp(ip));
  if (!limit.allowed) return limit.response;

  const id = publicIdSchema.safeParse((await context.params).id);
  if (!id.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  if (!publicCovenantVerificationReady()) {
    return apiError(
      ErrorCodes.BOT_VERIFICATION_UNAVAILABLE,
      "Human verification is unavailable. Please try later.",
      503,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid request.", 400);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      "Enter a valid address and complete the human check.",
      400,
    );
  }

  let address: string;
  try {
    address = normalizeGiveawayAddress(body.data.address);
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Enter a valid Kaspa mainnet address.", 400);
  }
  const verified = await verifyGiveawayTurnstile({
    token: body.data.turnstileToken,
    remoteIp: ip,
  });
  if (!verified.ok) {
    return apiError(
      verified.kind === "unavailable"
        ? ErrorCodes.BOT_VERIFICATION_UNAVAILABLE
        : ErrorCodes.BOT_VERIFICATION_FAILED,
      "Human verification failed. Please try again.",
      verified.kind === "unavailable" ? 503 : 403,
    );
  }

  if (isGiveawayV6CreationEnabled()) {
    const giveaway = await loadGiveawayV6(id.data);
    if (giveaway?.v6Bootstrap && giveaway.v6Projection) {
      return registerGiveawayV6(giveaway, address, hashClientIp(ip));
    }
  }

  if (process.env.GIVEAWAY_COVENANT_PROTOTYPE_ENABLED !== "true") {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  }
  return registerLegacyGiveaway(id.data, address);
}

async function registerGiveawayV6(
  giveaway: NonNullable<Awaited<ReturnType<typeof loadGiveawayV6>>>,
  address: string,
  ipHash: string,
): Promise<Response> {
  let restored: ReturnType<typeof restoreGiveawayV6Projection>;
  try {
    restored = restoreGiveawayV6Projection(giveaway.v6Projection!);
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Giveaway verification is temporarily unavailable.",
      503,
    );
  }
  if (giveaway.v6Projection!.phase !== GiveawayV6Phase.OPEN || restored.snapshot.phase !== "open") {
    return apiError(ErrorCodes.INVALID_STATE, "Entries are closed.", 409);
  }
  if (giveaway.v6Projection!.lastErrorCode !== null) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "On-chain verification is paused. Please try again shortly.",
      409,
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
  if (chain.daa >= restored.config.closesAtDaa) {
    return apiError(ErrorCodes.INVALID_STATE, "Entries are closed.", 409);
  }

  const activation = restored.checkpoint?.transitions.find(
    (transition) => transition.event.kind === "activate",
  )?.event;
  if (!activation || activation.kind !== "activate") {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Giveaway activation could not be reconstructed safely.",
      503,
    );
  }

  let registration: ReturnType<typeof buildGiveawayV6RegistrationTransaction>;
  try {
    registration = buildGiveawayV6RegistrationTransaction({
      activationBlockDaaScore: activation.blockDaaScore,
      config: restored.config,
      family: restored.family,
      payoutScriptPublicKeyHex: buildKaspaAddressScriptPublicKeyHex(address),
      shardTemplateRedeemScriptHex: giveaway.v6Bootstrap!.shardTemplateRedeemScriptHex,
      snapshot: restored.snapshot,
    });
  } catch (error) {
    if (error instanceof GiveawayV6ReconstructionError) {
      if (error.code === "DUPLICATE_ENTRY") {
        return apiError(ErrorCodes.INVALID_STATE, "This address is already entered.", 409);
      }
      if (error.code === "INVALID_STATE") {
        return apiError(ErrorCodes.INVALID_STATE, error.message, 409);
      }
    }
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Registration could not be reconstructed safely.",
      503,
    );
  }

  let submittedTransactionId: string;
  try {
    const submitted = await broadcastToccataGiveawayV6RegistrationTransaction({
      expectedTransactionId: registration.transactionId,
      transactionSafeJson: registration.transactionSafeJson,
    });
    submittedTransactionId = submitted.submittedTransactionId;
  } catch (error) {
    if (isAlreadyAccepted(error)) {
      submittedTransactionId = registration.transactionId;
    } else if (isRelayRejection(error)) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Another entry advanced this on-chain shard. Please retry in a few seconds.",
        409,
      );
    } else {
      return apiError(
        ErrorCodes.UPSTREAM_TIMEOUT,
        "Registration could not be submitted to Kaspa. Retrying is safe.",
        503,
      );
    }
  }
  if (submittedTransactionId.toLowerCase() !== registration.transactionId) {
    return apiError(ErrorCodes.SERVER_ERROR, "Kaspa returned an unexpected transaction ID.", 503);
  }

  await writeAuditLog(prisma, {
    actorType: AuditActorType.PUBLIC,
    creatorId: giveaway.creatorId,
    event: "giveaway.v6_registration_submitted",
    ipHash,
    metadata: {
      commitmentHex: registration.commitmentHex,
      publicId: giveaway.publicId,
      shardIndex: registration.shardIndex,
      transactionId: registration.transactionId,
    },
  }).catch(() => undefined);

  return apiJson(
    {
      address,
      confirmedEntryCount: restored.snapshot.observedRegistrationCount,
      registration: {
        commitmentHex: registration.commitmentHex,
        shardIndex: registration.shardIndex,
        status: "SUBMITTED",
        transactionId: registration.transactionId,
      },
    },
    202,
  );
}

async function registerLegacyGiveaway(id: string, address: string): Promise<Response> {
  try {
    return apiJson({ entryCount: await registerPublicCovenant(id, address), address }, 201);
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return apiError(ErrorCodes.INVALID_STATE, "This address is already entered.", 409);
    }
    const message = error instanceof Error ? error.message : "";
    if (
      [
        "Entries are closed.",
        "Prize funding is not available.",
        "This giveaway is full.",
        "Giveaway not found.",
      ].includes(message)
    ) {
      return apiError(ErrorCodes.INVALID_STATE, message, 409);
    }
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Registration is temporarily unavailable. Please retry.",
      503,
    );
  }
}

async function loadGiveawayV6(publicId: string) {
  return prisma.giveaway.findUnique({
    select: {
      creatorId: true,
      publicId: true,
      v6Bootstrap: { select: { shardTemplateRedeemScriptHex: true } },
      v6Projection: {
        select: {
          anchorHash: true,
          checkpoint: true,
          config: true,
          covenantIdHex: true,
          cursorHash: true,
          family: true,
          frozenEntryCount: true,
          id: true,
          lastErrorCode: true,
          lastPageFingerprint: true,
          network: true,
          observedRegistrationCount: true,
          phase: true,
          syncRevision: true,
          terminalTransactionId: true,
          winnerScriptPublicKeyHex: true,
        },
      },
    },
    where: { drawProtocolVersion: 6, publicId },
  });
}

function isAlreadyAccepted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /already (?:accepted|known)|transaction.*already/iu.test(message);
}

function isRelayRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /rejected transaction|invalid transaction|missing outpoint|double spend/iu.test(message);
}
