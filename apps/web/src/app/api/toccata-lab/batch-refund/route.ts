import { prisma, AuditActorType } from "@kaspa-actions/db";
import { createRestKaspaIndexer } from "@kaspa-actions/kaspa-indexer";

import { writeAuditLog } from "@/lib/audit";
import { parseStoredClaimableBatchOutputs } from "@/lib/claimable-batch-manifest";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { readCurrentMainnetDaaScore } from "@/lib/kaspa-daa";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  broadcastToccataBatchRefundTransaction,
  createToccataBatchAllocatorLabScript,
  isToccataBatchLabEnabled,
  readClaimableBroadcastSafeJsonSummary,
  readClaimableSpendMode,
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

  const batch = await prisma.claimableBatch.findUnique({
    where: {
      creatorId_batchKey: { batchKey: parsed.data.batchKey, creatorId: guard.creator.id },
    },
  });
  if (!batch) return apiError(ErrorCodes.NOT_FOUND, "Registered claimable batch not found.", 404);
  if (batch.status === "activated") {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Activated child outputs must be refunded individually.",
      409,
    );
  }
  if (batch.pendingActivationTxId) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Batch activation is already pending. Refresh its status before attempting a refund.",
      409,
    );
  }

  let summary: ReturnType<typeof readClaimableBroadcastSafeJsonSummary>;
  try {
    summary = readClaimableBroadcastSafeJsonSummary(parsed.data.transactionSafeJson);
    const outputs = parseStoredClaimableBatchOutputs(batch.expectedOutputs);
    const canonical = createToccataBatchAllocatorLabScript({
      activationPublicKey: batch.activationPublicKey,
      outputs,
      refundLockTime: batch.refundLockTime,
      refundPublicKey: batch.refundPublicKey,
    });
    if (
      canonical.fundingAddress !== batch.fundingAddress ||
      canonical.redeemScriptHex !== batch.redeemScriptHex
    ) {
      throw new Error("Registered batch contract is not canonical.");
    }
    if (summary.transactionId !== parsed.data.expectedTransactionId.toLowerCase()) {
      throw new Error("Signed batch refund id does not match the expected transaction id.");
    }
    if (
      readClaimableSpendMode(summary.signatureScriptHex, canonical.redeemScriptHex) !== "refund"
    ) {
      throw new Error("Signed transaction did not select the batch refund branch.");
    }
    if (
      summary.lockTime !== batch.refundLockTime ||
      summary.lockTime !== parsed.data.refundLockTime
    ) {
      throw new Error("Signed batch refund lock time does not match the registered expiry.");
    }
    if (
      summary.fundingAmountSompi !== batch.fundingAmountSompi.toString() ||
      summary.outputAmountSompi !== (batch.fundingAmountSompi - batch.activationFeeSompi).toString()
    ) {
      throw new Error("Signed batch refund amount does not match the registered contract.");
    }
  } catch (error) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      error instanceof Error ? error.message : "Signed batch refund is invalid.",
      400,
    );
  }

  if (batch.refundTxId) {
    if (batch.refundTxId === summary.transactionId) {
      return apiJson({
        broadcast: {
          submittedTransactionId: batch.refundTxId,
          transactionId: batch.refundTxId,
        },
        reconciled: true,
      });
    }
    return apiError(ErrorCodes.INVALID_STATE, "This batch was already refunded.", 409);
  }

  const currentDaaScore = await readCurrentMainnetDaaScore().catch(() => null);
  if (currentDaaScore === null) {
    return apiError(ErrorCodes.SERVER_ERROR, "Could not verify the current Kaspa DAA score.", 503);
  }
  if (currentDaaScore < BigInt(batch.refundLockTime)) {
    return apiError(ErrorCodes.INVALID_STATE, "Batch refund is not available until expiry.", 409);
  }

  const fundingMatch = await createRestKaspaIndexer({ cacheRevalidateSeconds: 3, limit: 20 })
    .findTransactionPayment({
      amountSompi: batch.fundingAmountSompi,
      notBefore: batch.createdAt.getTime(),
      recipientAddress: batch.fundingAddress,
      transactionId: summary.fundingTransactionId,
    })
    .catch(() => null);
  if (!fundingMatch || fundingMatch.outputIndex !== summary.fundingOutputIndex) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Registered batch funding output could not be verified on-chain.",
      409,
    );
  }
  if (
    (batch.fundingTxId && batch.fundingTxId !== summary.fundingTransactionId) ||
    (batch.fundingOutputIndex !== null && batch.fundingOutputIndex !== summary.fundingOutputIndex)
  ) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Signed refund does not spend the registered batch funding output.",
      409,
    );
  }

  const reservation = await prisma.claimableBatch.updateMany({
    data: {
      fundingOutputIndex: summary.fundingOutputIndex,
      fundingTxId: summary.fundingTransactionId,
      pendingRefundTxId: summary.transactionId,
      status: "funded",
    },
    where: {
      activationTxId: null,
      id: batch.id,
      pendingActivationTxId: null,
      refundTxId: null,
      status: { in: ["awaiting_funding", "funded"] },
      OR: [{ pendingRefundTxId: null }, { pendingRefundTxId: summary.transactionId }],
    },
  });
  if (reservation.count !== 1) {
    const current = await prisma.claimableBatch.findUnique({ where: { id: batch.id } });
    if (current?.refundTxId === summary.transactionId) {
      return apiJson({
        broadcast: {
          submittedTransactionId: summary.transactionId,
          transactionId: summary.transactionId,
        },
        reconciled: true,
      });
    }
    return apiError(
      ErrorCodes.INVALID_STATE,
      "This batch is already being activated or refunded. Refresh its status before retrying.",
      409,
    );
  }

  try {
    const broadcast = await broadcastToccataBatchRefundTransaction(parsed.data);
    await markRefunded(
      batch.id,
      guard.creator.id,
      batch.expectedOutputs,
      broadcast.submittedTransactionId,
    );
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "claimable_batch.refunded",
      ipHash: guard.ipHash,
      metadata: { batchKey: batch.batchKey },
    });
    return apiJson({ broadcast });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown batch refund error.";
    if (isAlreadyAcceptedMessage(message)) {
      await markRefunded(batch.id, guard.creator.id, batch.expectedOutputs, summary.transactionId);
      return apiJson({
        broadcast: {
          submittedTransactionId: summary.transactionId,
          transactionId: summary.transactionId,
        },
        reconciled: true,
      });
    }
    const timedOut = message.toLowerCase().includes("timed out");
    return apiError(
      timedOut ? ErrorCodes.UPSTREAM_TIMEOUT : ErrorCodes.INVALID_BODY,
      message,
      timedOut ? 504 : 400,
    );
  }
}

async function markRefunded(
  batchId: string,
  creatorId: string,
  expectedOutputs: unknown,
  transactionId: string,
) {
  const now = new Date();
  const outputs = parseStoredClaimableBatchOutputs(expectedOutputs);
  await prisma.$transaction([
    prisma.claimableBatch.update({
      data: {
        pendingActivationTxId: null,
        pendingRefundTxId: null,
        refundTxId: transactionId,
        status: "refunded",
      },
      where: { id: batchId },
    }),
    ...outputs.map((output) =>
      prisma.claimableLink.updateMany({
        data: { refundTxId: transactionId, refundedAt: now, status: "refunded" },
        where: { creatorId, linkKey: output.linkKey },
      }),
    ),
  ]);
}

function isAlreadyAcceptedMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already accepted") || normalized.includes("already in the mempool");
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
