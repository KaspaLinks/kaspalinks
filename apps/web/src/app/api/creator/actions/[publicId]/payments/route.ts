import { prisma } from "@kaspa-actions/db";
import { Network } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { z } from "zod";

import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { getKaspaIndexer } from "@/lib/indexer";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

const PAYMENT_SCAN_LIMIT = 25;
const publicIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+$/i);

export async function GET(request: Request, context: RouteContext) {
  const parsedPublicId = publicIdSchema.safeParse((await context.params).publicId);
  if (!parsedPublicId.success) {
    return apiError(ErrorCodes.INVALID_BODY, "publicId is invalid.", 400);
  }
  const publicId = parsedPublicId.data;
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const action = await prisma.action.findFirst({
    where: {
      creatorId: guard.creator.id,
      deletedAt: null,
      publicId,
    },
  });

  if (!action) {
    return apiError(ErrorCodes.NOT_FOUND, "Action not found.", 404);
  }

  const network = action.network === Network.TESTNET ? "testnet" : "mainnet";
  const indexer = getKaspaIndexer(network);
  if (!indexer) {
    return apiError(
      ErrorCodes.CHAIN_LOOKUP_DISABLED,
      "Chain lookup is not configured for this network.",
      503,
    );
  }

  try {
    const actionCreatedAtMs = action.createdAt.getTime();
    // Only receipts that arrived at or after the link was created can be
    // attributed to it. Receipts with no blockTime are excluded because we
    // cannot prove they happened post-creation. Without this filter, a
    // creator who reused an address that had already received KAS would see
    // every old receipt counted as Kaspa-Links earnings.
    const payments = (
      await indexer.listIncomingPayments({
        notBefore: actionCreatedAtMs,
        recipientAddress: action.recipientAddress,
        scanLimit: PAYMENT_SCAN_LIMIT,
      })
    ).filter((payment) => payment.blockTime !== null && payment.blockTime >= actionCreatedAtMs);
    const totalSompi = payments.reduce((sum, payment) => sum + payment.matchedSompi, 0n);

    return apiJson({
      action: {
        network,
        publicId: action.publicId,
        recipientAddress: action.recipientAddress,
      },
      payments: payments.map((payment) => ({
        amountKas: formatSompiToKaspa(payment.matchedSompi),
        amountSompi: payment.matchedSompi.toString(),
        blockTime: payment.blockTime,
        outputIndex: payment.outputIndex,
        transactionId: payment.transactionId,
      })),
      summary: {
        count: payments.length,
        providerId: indexer.providerId,
        scanLimit: PAYMENT_SCAN_LIMIT,
        totalKas: totalSompi === 0n ? "0" : formatSompiToKaspa(totalSompi),
        totalSompi: totalSompi.toString(),
      },
    });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Could not load address payments.", 502);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
