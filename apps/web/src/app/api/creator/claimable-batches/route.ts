import { prisma, AuditActorType, Network, Prisma } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import {
  parseStoredClaimableBatchOutputs,
  type StoredClaimableBatchOutput,
} from "@/lib/claimable-batch-manifest";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import {
  createToccataClaimableLabScript,
  registeredClaimableBatchInputSchema,
  ToccataLabSdkUnavailableError,
  validateRegisteredClaimableBatchMetadata,
} from "@/lib/toccata-lab";

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const batchKey = new URL(request.url).searchParams.get("batchKey")?.trim() ?? "";
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(batchKey)) {
    return apiError(ErrorCodes.INVALID_BODY, "batchKey is required.", 400);
  }

  let batch = await prisma.claimableBatch.findUnique({
    where: { creatorId_batchKey: { batchKey, creatorId: guard.creator.id } },
  });
  if (!batch) return apiError(ErrorCodes.NOT_FOUND, "Claimable batch not found.", 404);

  const outputs = parseStoredClaimableBatchOutputs(batch.expectedOutputs);
  if (batch.status === "funded" && batch.pendingActivationTxId) {
    const pendingActivationTxId = batch.pendingActivationTxId;
    if (await isAcceptedKaspaTransaction(pendingActivationTxId)) {
      await prisma.$transaction([
        prisma.claimableBatch.update({
          data: {
            activationTxId: pendingActivationTxId,
            pendingActivationTxId: null,
            status: "activated",
          },
          where: { id: batch.id },
        }),
        ...outputs.map((output, outputIndex) =>
          prisma.claimableLink.updateMany({
            data: {
              fundingOutputIndex: outputIndex,
              fundingTxId: pendingActivationTxId,
              status: "funded",
            },
            where: {
              creatorId: guard.creator.id,
              linkKey: output.linkKey,
              status: { notIn: ["claimed", "refunded", "spent_unknown"] },
            },
          }),
        ),
      ]);
      batch = await prisma.claimableBatch.findUnique({
        where: { creatorId_batchKey: { batchKey, creatorId: guard.creator.id } },
      });
    }
  }
  if (!batch) return apiError(ErrorCodes.NOT_FOUND, "Claimable batch not found.", 404);

  if (batch.status === "funded" && batch.pendingRefundTxId) {
    const pendingRefundTxId = batch.pendingRefundTxId;
    if (await isAcceptedKaspaTransaction(pendingRefundTxId)) {
      const now = new Date();
      await prisma.$transaction([
        prisma.claimableBatch.update({
          data: {
            pendingRefundTxId: null,
            refundTxId: pendingRefundTxId,
            status: "refunded",
          },
          where: { id: batch.id },
        }),
        ...outputs.map((output) =>
          prisma.claimableLink.updateMany({
            data: { refundTxId: pendingRefundTxId, refundedAt: now, status: "refunded" },
            where: {
              creatorId: guard.creator.id,
              linkKey: output.linkKey,
              status: { notIn: ["claimed", "refunded", "spent_unknown"] },
            },
          }),
        ),
      ]);
      batch = await prisma.claimableBatch.findUnique({
        where: { creatorId_batchKey: { batchKey, creatorId: guard.creator.id } },
      });
    }
  }
  if (!batch) return apiError(ErrorCodes.NOT_FOUND, "Claimable batch not found.", 404);

  const childLinks = await prisma.claimableLink.findMany({
    select: {
      claimTxId: true,
      deletedAt: true,
      fundingOutputIndex: true,
      fundingTxId: true,
      linkKey: true,
      refundTxId: true,
      status: true,
    },
    where: {
      creatorId: guard.creator.id,
      linkKey: { in: outputs.map((output) => output.linkKey) },
    },
  });
  const childByKey = new Map(childLinks.map((link) => [link.linkKey, link]));

  return apiJson({
    claimableBatch: {
      activationTxId: batch.activationTxId,
      batchKey: batch.batchKey,
      fundingOutputIndex: batch.fundingOutputIndex,
      fundingTxId: batch.fundingTxId,
      outputs: outputs.map((output, outputIndex) => {
        const child = childByKey.get(output.linkKey);
        return {
          ...output,
          claimTxId: child?.claimTxId ?? null,
          deletedAt: child?.deletedAt?.toISOString() ?? null,
          fundingOutputIndex: child?.fundingOutputIndex ?? null,
          fundingTxId: child?.fundingTxId ?? null,
          outputIndex,
          refundTxId: child?.refundTxId ?? null,
          status: child?.status ?? "unknown",
        };
      }),
      refundTxId: batch.refundTxId,
      status: batch.status,
    },
  });
}

export async function POST(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.CREATOR_ACTION_CREATE, guard.creator.id);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = registeredClaimableBatchInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid claimable batch manifest.",
      400,
    );
  }

  let canonical: ReturnType<typeof validateRegisteredClaimableBatchMetadata>;
  try {
    canonical = validateRegisteredClaimableBatchMetadata(parsed.data);
  } catch (error) {
    if (error instanceof ToccataLabSdkUnavailableError) {
      return apiError(ErrorCodes.SERVER_ERROR, "Claimable batch validation is unavailable.", 503);
    }
    return apiError(
      ErrorCodes.INVALID_BODY,
      error instanceof Error ? error.message : "Invalid claimable batch manifest.",
      400,
    );
  }

  const childLinks = await prisma.claimableLink.findMany({
    where: {
      creatorId: guard.creator.id,
      deletedAt: null,
      linkKey: { in: canonical.outputs.map((output) => output.linkKey) },
    },
  });
  if (childLinks.length !== canonical.outputs.length) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Every batch output must be registered to this creator before the batch is registered.",
      409,
    );
  }

  const childByKey = new Map(childLinks.map((link) => [link.linkKey, link]));
  for (const output of canonical.outputs) {
    const child = childByKey.get(output.linkKey);
    if (!child || child.amountSompi !== output.amountSompi) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Batch output amount does not match its child link.",
        409,
      );
    }
    const childScript = createToccataClaimableLabScript({
      linkPublicKey: child.claimPublicKey,
      refundLockTime: child.refundLockTime,
      refundPublicKey: child.refundPublicKey,
    });
    if (
      childScript.redeemScriptHex !== child.redeemScriptHex.toLowerCase() ||
      serializeScriptPublicKey(childScript.scriptPublicKey) !== output.scriptPublicKeyHex
    ) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Batch output script does not match its registered child link.",
        409,
      );
    }
  }

  const storedOutputs: StoredClaimableBatchOutput[] = canonical.outputs.map((output) => ({
    amountSompi: output.amountSompi.toString(),
    linkKey: output.linkKey,
    scriptPublicKeyHex: output.scriptPublicKeyHex,
  }));
  const immutable = {
    activationFeeSompi: canonical.activationFeeSompi,
    activationPublicKey: canonical.activationPublicKey,
    creatorId: guard.creator.id,
    expectedOutputs: storedOutputs as unknown as Prisma.InputJsonValue,
    fundingAddress: canonical.fundingAddress,
    fundingAmountSompi: canonical.fundingAmountSompi,
    network: Network.MAINNET,
    redeemScriptHex: canonical.redeemScriptHex,
    refundLockTime: canonical.refundLockTime,
    refundPublicKey: canonical.refundPublicKey,
    title: canonical.title,
  };

  const existing = await prisma.claimableBatch.findUnique({
    where: { batchKey: canonical.batchKey },
  });
  if (existing) {
    if (
      existing.creatorId !== guard.creator.id ||
      !sameManifest(existing, immutable, storedOutputs)
    ) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Batch key is already registered with different public contract terms.",
        409,
      );
    }
    return apiJson({ claimableBatch: { batchKey: existing.batchKey, status: existing.status } });
  }

  let batch;
  try {
    batch = await prisma.claimableBatch.create({
      data: { batchKey: canonical.batchKey, ...immutable },
    });
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error, ["batchKey"])) throw error;

    const raced = await prisma.claimableBatch.findUnique({
      where: { batchKey: canonical.batchKey },
    });
    if (
      !raced ||
      raced.creatorId !== guard.creator.id ||
      !sameManifest(raced, immutable, storedOutputs)
    ) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Batch key is already registered with different public contract terms.",
        409,
      );
    }
    return apiJson({ claimableBatch: { batchKey: raced.batchKey, status: raced.status } });
  }
  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "claimable_batch.created",
    ipHash: guard.ipHash,
    metadata: { batchKey: batch.batchKey, outputCount: storedOutputs.length },
  });

  return apiJson({ claimableBatch: { batchKey: batch.batchKey, status: batch.status } });
}

function sameManifest(
  existing: {
    activationFeeSompi: bigint;
    activationPublicKey: string;
    expectedOutputs: unknown;
    fundingAddress: string;
    fundingAmountSompi: bigint;
    redeemScriptHex: string;
    refundLockTime: string;
    refundPublicKey: string;
    title: string;
  },
  immutable: {
    activationFeeSompi: bigint;
    activationPublicKey: string;
    fundingAddress: string;
    fundingAmountSompi: bigint;
    redeemScriptHex: string;
    refundLockTime: string;
    refundPublicKey: string;
    title: string;
  },
  outputs: StoredClaimableBatchOutput[],
): boolean {
  return (
    existing.activationFeeSompi === immutable.activationFeeSompi &&
    existing.activationPublicKey === immutable.activationPublicKey &&
    existing.fundingAddress === immutable.fundingAddress &&
    existing.fundingAmountSompi === immutable.fundingAmountSompi &&
    existing.redeemScriptHex === immutable.redeemScriptHex &&
    existing.refundLockTime === immutable.refundLockTime &&
    existing.refundPublicKey === immutable.refundPublicKey &&
    existing.title === immutable.title &&
    JSON.stringify(parseStoredClaimableBatchOutputs(existing.expectedOutputs)) ===
      JSON.stringify(outputs)
  );
}

function serializeScriptPublicKey(value: { script: string; version: number }): string {
  return value.version.toString(16).padStart(4, "0") + value.script.toLowerCase();
}

async function isAcceptedKaspaTransaction(transactionId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.kaspa.org/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { accept: "application/json" }, next: { revalidate: 2 } },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as Record<string, unknown>;
    return (
      body.is_accepted === true &&
      typeof body.transaction_id === "string" &&
      body.transaction_id.toLowerCase() === transactionId.toLowerCase()
    );
  } catch {
    return false;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "POST"]);

export { methodNotAllowed as DELETE, methodNotAllowed as PATCH, methodNotAllowed as PUT };
