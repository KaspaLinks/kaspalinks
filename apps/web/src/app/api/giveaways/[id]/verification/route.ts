import { restoreGiveawayV6Projection } from "@kaspa-actions/application";
import { Network, prisma } from "@kaspa-actions/db";
import {
  serializeGiveawayV6ConfigJson,
  serializeGiveawayV6FamilyJson,
  serializeGiveawayV6ProjectionCheckpoint,
  serializeGiveawayV6Snapshot,
} from "@kaspa-actions/kaspa-indexer";
import { headers } from "next/headers";
import { z } from "zod";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

const publicIdSchema = z.string().cuid();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const parsedId = publicIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const limited = enforceRateLimit(
    RateBuckets.GIVEAWAY_V6_VERIFICATION,
    hashClientIp(extractClientIp(await headers())),
  );
  if (!limited.allowed) return limited.response;

  const giveaway = await prisma.giveaway.findUnique({
    select: {
      amountSompi: true,
      publicId: true,
      title: true,
      v6Projection: {
        select: {
          id: true,
          network: true,
          covenantIdHex: true,
          anchorHash: true,
          config: true,
          family: true,
          checkpoint: true,
          phase: true,
          observedRegistrationCount: true,
          frozenEntryCount: true,
          winnerScriptPublicKeyHex: true,
          terminalTransactionId: true,
          cursorHash: true,
          lastPageFingerprint: true,
          syncRevision: true,
          lastSyncedAt: true,
          lastErrorCode: true,
        },
      },
    },
    where: { publicId: parsedId.data },
  });
  if (!giveaway?.v6Projection) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway verification not found.", 404);
  }

  try {
    const restored = restoreGiveawayV6Projection(giveaway.v6Projection);
    const checkpoint = restored.checkpoint
      ? serializeGiveawayV6ProjectionCheckpoint(restored.checkpoint)
      : null;
    return apiJson({
      giveaway: {
        amountSompi: giveaway.amountSompi.toString(),
        publicId: giveaway.publicId,
        title: giveaway.title,
      },
      protocol: {
        version: 6,
        network: giveaway.v6Projection.network === Network.MAINNET ? "mainnet" : "testnet-10",
        config: serializeGiveawayV6ConfigJson(restored.config),
        family: serializeGiveawayV6FamilyJson(restored.family),
      },
      chain: {
        anchorHash: giveaway.v6Projection.anchorHash,
        cursorHash: checkpoint?.cursorHash ?? null,
        lastSyncedAt: giveaway.v6Projection.lastSyncedAt?.toISOString() ?? null,
        status: giveaway.v6Projection.lastErrorCode ? "verification_paused" : "verified",
      },
      projection: {
        snapshot: serializeGiveawayV6Snapshot(restored.snapshot),
        transitions: checkpoint?.transitions ?? [],
      },
    });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Giveaway verification is unavailable.", 503);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);
export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
