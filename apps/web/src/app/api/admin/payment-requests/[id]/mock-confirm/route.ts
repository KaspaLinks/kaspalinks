import { prisma } from "@kaspa-actions/db";
import { AuditActorType, PaymentRequestStatus } from "@kaspa-actions/db";

import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { generateFakeTxId, isMockConfirmEnabled } from "@/lib/mock-confirm";
import { serializePaymentRequest, shouldLazyExpire } from "@/lib/payment-request-serializer";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  const guard = await requireAdmin(request, prisma, {
    event: "admin.mock_confirm_unauthorized",
    metadata: { paymentRequestId: id },
  });
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.MOCK_CONFIRM, guard.ipHash);
  if (!limited.allowed) return limited.response;

  if (!isMockConfirmEnabled()) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.ADMIN,
      event: "mock_confirm.attempted_while_disabled",
      ipHash: guard.ipHash,
      metadata: { paymentRequestId: id },
      paymentRequestId: id,
    });
    return apiError(
      ErrorCodes.MOCK_CONFIRM_DISABLED,
      "Mock-confirm is disabled on this deployment.",
      403,
    );
  }

  const paymentRequest = await prisma.paymentRequest.findUnique({ where: { id } });
  if (!paymentRequest) {
    return apiError(ErrorCodes.NOT_FOUND, "Payment request not found.", 404);
  }

  if (shouldLazyExpire(paymentRequest)) {
    const expired = await prisma.paymentRequest.update({
      data: {
        failedAt: new Date(),
        status: PaymentRequestStatus.EXPIRED,
      },
      where: { id: paymentRequest.id },
    });

    await writeAuditLog(prisma, {
      actionId: expired.actionId,
      actorType: AuditActorType.SYSTEM,
      event: "payment_request.lazy_expired",
      ipHash: guard.ipHash,
      paymentRequestId: expired.id,
    });

    await writeAuditLog(prisma, {
      actionId: expired.actionId,
      actorType: AuditActorType.ADMIN,
      event: "mock_confirm.invalid_state_transition",
      ipHash: guard.ipHash,
      metadata: { from: expired.status, to: "CONFIRMED" },
      paymentRequestId: expired.id,
    });

    return apiError(
      ErrorCodes.INVALID_STATE,
      "Payment request is expired and cannot be confirmed.",
      409,
    );
  }

  if (paymentRequest.status !== PaymentRequestStatus.PENDING) {
    await writeAuditLog(prisma, {
      actionId: paymentRequest.actionId,
      actorType: AuditActorType.ADMIN,
      event: "mock_confirm.invalid_state_transition",
      ipHash: guard.ipHash,
      metadata: { from: paymentRequest.status, to: "CONFIRMED" },
      paymentRequestId: paymentRequest.id,
    });
    return apiError(
      ErrorCodes.INVALID_STATE,
      `Payment request is ${paymentRequest.status} and cannot be confirmed.`,
      409,
    );
  }

  const fakeTxId = generateFakeTxId();
  const confirmed = await prisma.paymentRequest.update({
    data: {
      confirmedAt: new Date(),
      detectionSource: "mock",
      fakeTxId,
      status: PaymentRequestStatus.CONFIRMED,
    },
    where: { id: paymentRequest.id },
  });

  await writeAuditLog(prisma, {
    actionId: confirmed.actionId,
    actorType: AuditActorType.ADMIN,
    event: "payment_request.mock_confirmed",
    ipHash: guard.ipHash,
    metadata: { fakeTxId },
    paymentRequestId: confirmed.id,
  });

  return apiJson({ paymentRequest: serializePaymentRequest(confirmed) });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
