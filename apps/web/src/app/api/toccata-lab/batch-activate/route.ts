import { prisma, AuditActorType } from "@kaspa-actions/db";
import { createRestKaspaIndexer } from "@kaspa-actions/kaspa-indexer";

import { writeAuditLog } from "@/lib/audit";
import { parseStoredClaimableBatchOutputs } from "@/lib/claimable-batch-manifest";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  broadcastToccataBatchActivationTransaction,
  createToccataBatchAllocatorLabScript,
  isToccataBatchLabEnabled,
  readBatchActivationBroadcastSafeJsonSummary,
  readClaimableSpendMode,
  toccataBatchActivationBroadcastInputSchema,
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

  const parsed = toccataBatchActivationBroadcastInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid batch activation request.",
      400,
    );
  }

  const batch = await prisma.claimableBatch.findUnique({
    where: {
      creatorId_batchKey: { batchKey: parsed.data.batchKey, creatorId: guard.creator.id },
    },
  });
  if (!batch) return apiError(ErrorCodes.NOT_FOUND, "Registered claimable batch not found.", 404);
  if (batch.status === "refunded") {
    return apiError(ErrorCodes.INVALID_STATE, "This batch was already refunded.", 409);
  }

  const outputs = parseStoredClaimableBatchOutputs(batch.expectedOutputs);
  let summary: ReturnType<typeof readBatchActivationBroadcastSafeJsonSummary>;
  try {
    summary = readBatchActivationBroadcastSafeJsonSummary(parsed.data.transactionSafeJson);
    validateSignedActivation({
      batch,
      outputs,
      summary,
      expectedTransactionId: parsed.data.expectedTransactionId,
    });
  } catch (error) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      error instanceof Error ? error.message : "Signed batch activation is invalid.",
      400,
    );
  }

  if (batch.activationTxId) {
    if (batch.activationTxId === summary.transactionId) {
      return apiJson({
        broadcast: {
          submittedTransactionId: batch.activationTxId,
          transactionId: batch.activationTxId,
        },
        reconciled: true,
      });
    }
    return apiError(ErrorCodes.INVALID_STATE, "This batch was already activated.", 409);
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
      "Signed activation does not spend the registered batch funding output.",
      409,
    );
  }

  await prisma.claimableBatch.update({
    data: {
      fundingOutputIndex: summary.fundingOutputIndex,
      fundingTxId: summary.fundingTransactionId,
      pendingActivationTxId: summary.transactionId,
      status: "funded",
    },
    where: { id: batch.id },
  });

  try {
    const broadcast = await broadcastToccataBatchActivationTransaction(parsed.data);
    await markActivated({
      batchId: batch.id,
      creatorId: guard.creator.id,
      outputs,
      transactionId: broadcast.submittedTransactionId,
    });
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "claimable_batch.activated",
      ipHash: guard.ipHash,
      metadata: { batchKey: batch.batchKey, outputCount: outputs.length },
    });
    return apiJson({ broadcast });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown batch activation error.";
    if (isAlreadyAcceptedMessage(message)) {
      await markActivated({
        batchId: batch.id,
        creatorId: guard.creator.id,
        outputs,
        transactionId: summary.transactionId,
      });
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

function validateSignedActivation(input: {
  batch: {
    activationPublicKey: string;
    fundingAddress: string;
    fundingAmountSompi: bigint;
    redeemScriptHex: string;
    refundLockTime: string;
    refundPublicKey: string;
  };
  expectedTransactionId: string;
  outputs: Array<{ amountSompi: string; scriptPublicKeyHex: string }>;
  summary: ReturnType<typeof readBatchActivationBroadcastSafeJsonSummary>;
}) {
  const canonical = createToccataBatchAllocatorLabScript({
    activationPublicKey: input.batch.activationPublicKey,
    outputs: input.outputs,
    refundLockTime: input.batch.refundLockTime,
    refundPublicKey: input.batch.refundPublicKey,
  });
  if (
    canonical.fundingAddress !== input.batch.fundingAddress ||
    canonical.redeemScriptHex !== input.batch.redeemScriptHex
  ) {
    throw new Error("Registered batch contract is not canonical.");
  }
  if (input.expectedTransactionId.toLowerCase() !== input.summary.transactionId) {
    throw new Error("Signed batch activation id does not match the expected transaction id.");
  }
  if (
    readClaimableSpendMode(input.summary.signatureScriptHex, canonical.redeemScriptHex) !== "claim"
  ) {
    throw new Error("Signed transaction did not select the batch activation branch.");
  }
  if (input.summary.lockTime !== "0") {
    throw new Error("Batch activation lock time must be zero.");
  }
  if (input.summary.fundingAmountSompi !== input.batch.fundingAmountSompi.toString()) {
    throw new Error("Signed transaction funding amount does not match the registered batch.");
  }
  if (input.summary.outputs.length !== input.outputs.length) {
    throw new Error("Signed transaction output count does not match the registered batch.");
  }
  input.outputs.forEach((output, index) => {
    const signed = input.summary.outputs[index];
    if (
      !signed ||
      signed.amountSompi !== output.amountSompi ||
      signed.scriptPublicKeyHex !== output.scriptPublicKeyHex
    ) {
      throw new Error(
        `Signed transaction output ${index + 1} does not match the registered batch.`,
      );
    }
  });
}

async function markActivated(input: {
  batchId: string;
  creatorId: string;
  outputs: Array<{ linkKey: string }>;
  transactionId: string;
}) {
  await prisma.$transaction([
    prisma.claimableBatch.update({
      data: {
        activationTxId: input.transactionId,
        pendingActivationTxId: null,
        status: "activated",
      },
      where: { id: input.batchId },
    }),
    ...input.outputs.map((output, outputIndex) =>
      prisma.claimableLink.updateMany({
        data: {
          fundingOutputIndex: outputIndex,
          fundingTxId: input.transactionId,
          status: "funded",
        },
        where: { creatorId: input.creatorId, linkKey: output.linkKey },
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
