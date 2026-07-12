import { prisma } from "@kaspa-actions/db";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  broadcastToccataBatchRefundTransaction,
  isToccataBatchLabEnabled,
  readClaimableBroadcastSafeJsonSummary,
  toccataBatchRefundBroadcastInputSchema,
} from "@/lib/toccata-lab";

export async function POST(request: Request) {
  if (!isToccataBatchLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Batch claim lab is disabled.", 403);
  }

  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(
    RateBuckets.TOCCATA_LAB_CLAIMABLE_BROADCAST,
    `${guard.creator.id}:${hashClientIp(extractClientIp(request.headers))}`,
  );
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = toccataBatchRefundBroadcastInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid batch refund request.",
      400,
    );
  }

  try {
    const summary = readClaimableBroadcastSafeJsonSummary(parsed.data.transactionSafeJson);
    if (summary.lockTime !== parsed.data.refundLockTime) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "Signed batch refund lock time does not match the requested expiry.",
        400,
      );
    }
    const currentDaaScore = await readCurrentDaaScore();
    if (currentDaaScore < BigInt(parsed.data.refundLockTime)) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Batch refund is not available until expiry.",
        409,
      );
    }

    const broadcast = await broadcastToccataBatchRefundTransaction(parsed.data);
    return apiJson({
      broadcast,
      warning: "The protected batch lab relayed signed JSON only; its refund code stayed browser-side.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown batch refund error.";
    const timedOut = message.toLowerCase().includes("timed out");
    return apiError(
      timedOut ? ErrorCodes.UPSTREAM_TIMEOUT : ErrorCodes.INVALID_BODY,
      message,
      timedOut ? 504 : 400,
    );
  }
}

async function readCurrentDaaScore(): Promise<bigint> {
  const response = await fetch("https://api.kaspa.org/info/blockdag", {
    headers: { accept: "application/json" },
    next: { revalidate: 5 },
  });
  if (!response.ok) throw new Error("Could not read current Kaspa DAA score.");
  const body = (await response.json()) as { networkName?: unknown; virtualDaaScore?: unknown };
  if (
    body.networkName !== "kaspa-mainnet" ||
    typeof body.virtualDaaScore !== "string" ||
    !/^[0-9]+$/.test(body.virtualDaaScore)
  ) {
    throw new Error("Unexpected Kaspa BlockDAG response.");
  }
  return BigInt(body.virtualDaaScore);
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
