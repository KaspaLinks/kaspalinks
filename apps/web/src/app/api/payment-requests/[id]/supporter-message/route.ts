import { prisma } from "@kaspa-actions/db";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { serializePaymentRequest } from "@/lib/payment-request-serializer";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  formatZodErrorMessage,
  updatePaymentRequestSupporterMessageInputSchema,
} from "@/lib/schemas";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.PAYMENT_REQUEST_UPDATE, ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = updatePaymentRequestSupporterMessageInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }
  const supporterPublic = parsed.data.supporterPublic === true;
  const supporterName = supporterPublic ? (parsed.data.supporterName ?? null) : null;

  const { id } = await context.params;
  const paymentRequest = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!paymentRequest) {
    return apiError(ErrorCodes.NOT_FOUND, "Payment request not found.", 404);
  }

  if (paymentRequest.status !== "PENDING" || paymentRequest.expiresAt.getTime() <= Date.now()) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "Only pending payment requests can update supporter messages.",
      409,
    );
  }

  const updated = await prisma.paymentRequest.update({
    data: {
      supporterMessage: parsed.data.supporterMessage ?? null,
      supporterName,
      supporterPublic,
    },
    where: { id },
  });

  return apiJson({ paymentRequest: serializePaymentRequest(updated) });
}

const methodNotAllowed = () => apiMethodNotAllowed(["PATCH"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
