import { prisma } from "@kaspa-actions/db";
import { ActionType, AuditActorType, PaymentRequestStatus } from "@kaspa-actions/db";
import { buildKaspaPaymentUri, parseKaspaAmountToSompi } from "@kaspa-actions/kaspa";

import { isActionDeleted, isActionDisabled, isActionExpired } from "@/lib/action-serializer";
import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  getMainnetOutputMinimumMessage,
  isBelowReliableMainnetOutputMinimum,
} from "@/lib/mainnet-amount-policy";
import {
  PAYMENT_REQUEST_LIFETIME_MS,
  serializePaymentRequest,
} from "@/lib/payment-request-serializer";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  createPaymentRequestInputSchema,
  formatZodErrorMessage,
  MIN_REQUIRED_NOTE_LENGTH,
} from "@/lib/schemas";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { publicId } = await context.params;
  const ipHash = hashClientIp(extractClientIp(request.headers));

  const limited = enforceRateLimit(RateBuckets.PAYMENT_REQUEST_CREATE, ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown = {};
  const rawText = await request.text();
  if (rawText.trim().length > 0) {
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
    }
  }

  const parsed = createPaymentRequestInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }
  const supporterPublic = parsed.data.supporterPublic === true;
  const supporterName = supporterPublic ? (parsed.data.supporterName ?? null) : null;

  const action = await prisma.action.findUnique({ where: { publicId } });
  if (!action || isActionDeleted(action)) {
    return apiError(ErrorCodes.NOT_FOUND, "Action not found.", 404);
  }

  if (isActionDisabled(action)) {
    return apiError(ErrorCodes.ACTION_DISABLED, "Action is disabled.", 403);
  }

  if (isActionExpired(action)) {
    return apiError(ErrorCodes.ACTION_EXPIRED, "Action has expired.", 410);
  }

  // If the creator flagged this Action as "note required", reject any
  // payment-request whose supporter note is missing or shorter than the
  // minimum length. The pay-page UI gates the Pay button on the same
  // rule; this is the server-side defence-in-depth so the gate can't be
  // skipped by a hand-crafted POST.
  if (action.noteRequired) {
    const supplied = parsed.data.supporterMessage?.trim() ?? "";
    if (supplied.length < MIN_REQUIRED_NOTE_LENGTH) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        `This link requires a note of at least ${MIN_REQUIRED_NOTE_LENGTH} characters from the supporter.`,
        400,
      );
    }
  }

  if (action.type === ActionType.KASPA_GOAL && action.goalAutoClose && action.goalSompi !== null) {
    const aggregate = await prisma.paymentRequest.aggregate({
      _sum: { amountSompi: true },
      where: {
        actionId: action.id,
        status: PaymentRequestStatus.CONFIRMED,
      },
    });
    const raisedSompi = aggregate._sum.amountSompi ?? 0n;

    if (raisedSompi >= action.goalSompi) {
      await writeAuditLog(prisma, {
        actionId: action.id,
        actorType: AuditActorType.PUBLIC,
        event: "goal.payment_request_blocked_after_target",
        ipHash,
        metadata: {
          goalSompi: action.goalSompi.toString(),
          publicId: action.publicId,
          raisedSompi: raisedSompi.toString(),
        },
      });

      return apiError(
        ErrorCodes.GOAL_CLOSED,
        "This goal has reached its target and is closed for new contributions.",
        409,
      );
    }
  }

  // Resolve the effective amount: Action's fixed amount wins; otherwise the
  // supporter may set a per-request amount; otherwise the PaymentRequest stays
  // amount-less and the wallet/QR omits the amount param.
  let amountSompi: bigint | null = action.amountSompi ?? null;
  if (amountSompi === null) {
    const requestedKas = parsed.data.amountKas;
    if (typeof requestedKas === "string" && requestedKas.length > 0) {
      amountSompi = parseKaspaAmountToSompi(requestedKas);
    }
  }

  if (amountSompi !== null && isBelowReliableMainnetOutputMinimum(amountSompi)) {
    return apiError(ErrorCodes.INVALID_BODY, getMainnetOutputMinimumMessage("Payment amount"), 400);
  }

  const paymentUri = buildKaspaPaymentUri({
    amountSompi: amountSompi ?? undefined,
    label: action.title,
    message: parsed.data.requestedMessage ?? action.message ?? null,
    recipientAddress: action.recipientAddress,
  });

  const expiresAt = new Date(Date.now() + PAYMENT_REQUEST_LIFETIME_MS);

  const paymentRequest = await prisma.paymentRequest.create({
    data: {
      actionId: action.id,
      amountSompi,
      expiresAt,
      network: action.network,
      paymentUri,
      recipientAddress: action.recipientAddress,
      requestedMessage: parsed.data.requestedMessage ?? null,
      supporterMessage: parsed.data.supporterMessage ?? null,
      supporterName,
      supporterPublic,
    },
  });

  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.PUBLIC,
    event: "payment_request.created",
    ipHash,
    metadata: {
      publicId: action.publicId,
      variableAmount: amountSompi === null,
    },
    paymentRequestId: paymentRequest.id,
  });

  return apiJson({ paymentRequest: serializePaymentRequest(paymentRequest) }, 201);
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
