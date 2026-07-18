import { prisma } from "@kaspa-actions/db";
import { createRestKaspaIndexer } from "@kaspa-actions/kaspa-indexer";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { TOCCATA_CANARY_MIN_OUTPUT_SOMPI } from "@/lib/toccata-lab-fee";
import {
  broadcastToccataClaimableTransaction,
  isToccataLabEnabled,
  readClaimableBroadcastSafeJsonSummary,
  readClaimableSpendMode,
  ToccataLabSdkUnavailableError,
  toccataClaimableBroadcastInputSchema,
  validateRegisteredClaimableMetadata,
} from "@/lib/toccata-lab";

const blockDagInfoSchema = {
  isValid(value: unknown): value is {
    networkName: string;
    virtualDaaScore: string;
  } {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { networkName?: unknown }).networkName === "string" &&
      typeof (value as { virtualDaaScore?: unknown }).virtualDaaScore === "string" &&
      /^[0-9]+$/.test((value as { virtualDaaScore: string }).virtualDaaScore)
    );
  },
};

export async function POST(request: Request) {
  if (!isToccataLabEnabled()) {
    return apiError(
      ErrorCodes.TOCCATA_LAB_DISABLED,
      "Claimable links are disabled on this deployment.",
      403,
    );
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_CLAIMABLE_BROADCAST, ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = toccataClaimableBroadcastInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid claimable-link broadcast request.",
      400,
    );
  }

  const transactionId = parsed.data.expectedTransactionId;
  console.info("[toccata-lab] claimable broadcast received", {
    bytes: parsed.data.transactionSafeJson.length,
    linkKey: parsed.data.linkKey,
    transactionId,
  });

  let verified:
    | {
        linkId: string;
        mismatchRecovery: boolean;
        mode: "claim" | "refund";
        summary: ReturnType<typeof readClaimableBroadcastSafeJsonSummary>;
      }
    | undefined;

  try {
    const safeJsonSummary = readClaimableBroadcastSafeJsonSummary(parsed.data.transactionSafeJson);
    if (parsed.data.expectedTransactionId.toLowerCase() !== safeJsonSummary.transactionId) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "Signed transaction id does not match the expected transaction id.",
        400,
      );
    }

    const link = await prisma.claimableLink.findUnique({
      where: { linkKey: parsed.data.linkKey },
    });
    if (!link) {
      return apiError(ErrorCodes.NOT_FOUND, "Registered claimable link was not found.", 404);
    }
    let canonicalLink;
    try {
      canonicalLink = validateRegisteredClaimableMetadata(
        {
          amountSompi: link.amountSompi.toString(),
          claimPublicKey: link.claimPublicKey,
          feeSompi: link.feeSompi.toString(),
          fundingAddress: link.fundingAddress,
          redeemScriptHex: link.redeemScriptHex,
          refundLockTime: link.refundLockTime,
          refundPublicKey: link.refundPublicKey,
        },
        { allowLegacyAmount: true },
      );
    } catch (error) {
      if (error instanceof ToccataLabSdkUnavailableError) {
        return apiError(
          ErrorCodes.SERVER_ERROR,
          "Claimable link validation is temporarily unavailable.",
          503,
        );
      }
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Registered claimable link metadata failed canonical validation.",
        409,
      );
    }

    const mode = readClaimableSpendMode(
      safeJsonSummary.signatureScriptHex,
      canonicalLink.redeemScriptHex,
    );
    const actualFundingSompi = BigInt(safeJsonSummary.fundingAmountSompi);
    const matchesRegisteredOutpoint =
      (link.fundingTxId === null ||
        link.fundingTxId.toLowerCase() === safeJsonSummary.fundingTransactionId) &&
      (link.fundingOutputIndex === null ||
        link.fundingOutputIndex === safeJsonSummary.fundingOutputIndex);
    const mismatchRecovery =
      mode === "refund" &&
      (actualFundingSompi !== canonicalLink.amountSompi || !matchesRegisteredOutpoint);

    if (mode === "claim" && actualFundingSompi !== canonicalLink.amountSompi) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "A claim must spend the exact amount registered for this claimable link.",
        400,
      );
    }
    if (["claimed", "refunded", "spent_unknown"].includes(link.status) && !mismatchRecovery) {
      return apiError(ErrorCodes.INVALID_STATE, "This claimable link is already closed.", 409);
    }

    const expectedOutputSompi = actualFundingSompi - canonicalLink.feeSompi;
    if (expectedOutputSompi < TOCCATA_CANARY_MIN_OUTPUT_SOMPI) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Funding output is too small to recover after the network fee.",
        409,
      );
    }
    if (safeJsonSummary.outputAmountSompi !== expectedOutputSompi.toString()) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "Signed transaction output does not match its funding amount and registered fee.",
        400,
      );
    }
    if (!matchesRegisteredOutpoint && !mismatchRecovery) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Signed transaction does not spend the registered funding output.",
        409,
      );
    }

    const fundingMatch = await createRestKaspaIndexer({
      cacheRevalidateSeconds: 3,
      limit: 20,
    }).findTransactionPayment({
      amountSompi: actualFundingSompi,
      notBefore: link.createdAt.getTime(),
      recipientAddress: link.fundingAddress,
      transactionId: safeJsonSummary.fundingTransactionId,
    });
    if (!fundingMatch || fundingMatch.outputIndex !== safeJsonSummary.fundingOutputIndex) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Registered claimable funding output could not be verified on-chain.",
        409,
      );
    }

    const currentDaaScore = await readCurrentDaaScore();
    const refundLockTime = BigInt(link.refundLockTime);

    if (mode === "claim" && currentDaaScore >= refundLockTime) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Claim window has expired. This link can no longer be claimed through Kaspa Links.",
        409,
      );
    }

    if (mode === "refund" && currentDaaScore < refundLockTime) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Refund is not available until the claim window has expired.",
        409,
      );
    }
    if (
      (mode === "claim" && safeJsonSummary.lockTime !== "0") ||
      (mode === "refund" && safeJsonSummary.lockTime !== link.refundLockTime)
    ) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "Signed transaction lock time does not match its registered claimable branch.",
        400,
      );
    }

    verified = { linkId: link.id, mismatchRecovery, mode, summary: safeJsonSummary };

    const broadcast = await broadcastToccataClaimableTransaction(parsed.data);

    console.info("[toccata-lab] claimable broadcast succeeded", {
      submittedTransactionId: broadcast.submittedTransactionId,
      mode,
      transactionId: broadcast.transactionId,
    });

    if (!mismatchRecovery) {
      await markClaimableLinkBroadcasted({
        linkId: link.id,
        fundingOutputIndex: safeJsonSummary.fundingOutputIndex,
        fundingTransactionId: safeJsonSummary.fundingTransactionId,
        mode,
        transactionId: broadcast.submittedTransactionId,
      });
    }

    return apiJson({
      broadcast,
      mismatchRecovery,
      warning:
        "The server received signed transaction JSON only; claim/refund codes stay browser-side.",
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (verified && isAlreadyAcceptedMessage(message)) {
      if (!verified.mismatchRecovery) {
        await markClaimableLinkBroadcasted({
          linkId: verified.linkId,
          fundingOutputIndex: verified.summary.fundingOutputIndex,
          fundingTransactionId: verified.summary.fundingTransactionId,
          mode: verified.mode,
          transactionId,
        });
      }
      return apiJson({
        broadcast: {
          submittedTransactionId: transactionId,
          transactionId,
        },
        mismatchRecovery: verified.mismatchRecovery,
        warning: verified.mismatchRecovery
          ? "Kaspa had already accepted this browser-signed recovery transaction."
          : "Kaspa had already accepted this signed transaction; the registered link status was reconciled.",
      });
    }
    const timedOut = message.toLowerCase().includes("timed out");
    const dagUnavailable =
      message.startsWith("Could not read current Kaspa DAA score") ||
      message.startsWith("Unexpected Kaspa BlockDAG response");

    console.error("[toccata-lab] claimable broadcast failed", {
      message,
      transactionId,
    });

    return apiError(
      timedOut
        ? ErrorCodes.UPSTREAM_TIMEOUT
        : dagUnavailable
          ? ErrorCodes.SERVER_ERROR
          : ErrorCodes.INVALID_BODY,
      message,
      timedOut ? 504 : dagUnavailable ? 503 : 400,
    );
  }
}

async function readCurrentDaaScore(): Promise<bigint> {
  const response = await fetch("https://api.kaspa.org/info/blockdag", {
    headers: { accept: "application/json" },
    next: { revalidate: 5 },
  });

  if (!response.ok) {
    throw new Error("Could not read current Kaspa DAA score before broadcast.");
  }

  const parsed = await response.json();
  if (!blockDagInfoSchema.isValid(parsed) || parsed.networkName !== "kaspa-mainnet") {
    throw new Error("Unexpected Kaspa BlockDAG response before broadcast.");
  }

  return BigInt(parsed.virtualDaaScore);
}

async function markClaimableLinkBroadcasted(input: {
  fundingOutputIndex: number;
  fundingTransactionId: string;
  linkId: string;
  mode: "claim" | "refund";
  transactionId: string;
}) {
  const status = input.mode === "claim" ? "claimed" : "refunded";
  const now = new Date();
  await prisma.claimableLink.updateMany({
    data:
      input.mode === "claim"
        ? {
            claimedAt: now,
            claimTxId: input.transactionId,
            fundingOutputIndex: input.fundingOutputIndex,
            fundingTxId: input.fundingTransactionId,
            status,
          }
        : {
            fundingOutputIndex: input.fundingOutputIndex,
            fundingTxId: input.fundingTransactionId,
            refundedAt: now,
            refundTxId: input.transactionId,
            status,
          },
    where: {
      id: input.linkId,
      status: {
        notIn: ["claimed", "refunded", "spent_unknown"],
      },
    },
  });
}

function isAlreadyAcceptedMessage(message: string): boolean {
  return /already accepted|was already accepted by the consensus/i.test(message);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error.trim();
  return "Unknown Kaspa broadcast error.";
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
