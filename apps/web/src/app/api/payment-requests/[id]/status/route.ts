import { prisma } from "@kaspa-actions/db";
import { AuditActorType, PaymentRequestStatus } from "@kaspa-actions/db";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { getRealtimeKaspaIndexer } from "@/lib/indexer";
import { detectAndConfirmPayment } from "@/lib/payment-detector";
import { serializePaymentRequest, shouldLazyExpire } from "@/lib/payment-request-serializer";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const statusQuerySchema = z.object({
  txId: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
});

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const parsedQuery = statusQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!parsedQuery.success) {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid status query parameters.", 400);
  }
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.PAYMENT_REQUEST_STATUS, ipHash);
  if (!limited.allowed) return limited.response;

  let paymentRequest = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!paymentRequest) {
    return apiError(ErrorCodes.NOT_FOUND, "Payment request not found.", 404);
  }

  if (shouldLazyExpire(paymentRequest)) {
    const expiration = await prisma.paymentRequest.updateMany({
      data: {
        failedAt: new Date(),
        status: PaymentRequestStatus.EXPIRED,
      },
      where: {
        id: paymentRequest.id,
        status: PaymentRequestStatus.PENDING,
      },
    });
    const current = await prisma.paymentRequest.findUnique({ where: { id: paymentRequest.id } });
    if (!current) {
      return apiError(ErrorCodes.NOT_FOUND, "Payment request not found.", 404);
    }
    paymentRequest = current;

    if (expiration.count > 0) {
      await writeAuditLog(prisma, {
        actionId: paymentRequest.actionId,
        actorType: AuditActorType.SYSTEM,
        event: "payment_request.lazy_expired",
        ipHash,
        paymentRequestId: paymentRequest.id,
      });
    }

    return apiJson({ paymentRequest: serializePaymentRequest(paymentRequest) });
  }

  if (paymentRequest.status === PaymentRequestStatus.PENDING) {
    const network = paymentRequest.network === "TESTNET" ? "testnet" : "mainnet";
    const indexer = getRealtimeKaspaIndexer(network);
    if (indexer) {
      const result = await detectAndConfirmPayment(paymentRequest, indexer, prisma, {
        ipHash,
        reportedTxId: parsedQuery.data.txId ?? null,
      });
      if (result.kind === "confirmed") {
        return apiJson({ paymentRequest: serializePaymentRequest(result.paymentRequest) });
      }
    }
  }

  return apiJson({ paymentRequest: serializePaymentRequest(paymentRequest) });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
