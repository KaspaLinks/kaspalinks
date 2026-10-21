import {
  lockActionPaymentLifecycle,
  lockRecipientPaymentLifecycle,
} from "@kaspa-actions/application";
import { prisma, type Prisma } from "@kaspa-actions/db";
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

  if (action.type === ActionType.KASPA_INVOICE && action.invoicePaidAt !== null) {
    return apiError(
      ErrorCodes.INVOICE_PAID,
      "This invoice has already been paid and cannot accept another payment request.",
      409,
    );
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
  const requestedMessage = parsed.data.requestedMessage ?? null;
  const supporterMessage = parsed.data.supporterMessage ?? null;
  // A request that only carries the amount is the same payment intent as an
  // open one from the same payer, so it may be handed back instead.
  const plainRequest = supporterMessage === null && supporterName === null && !supporterPublic;
  let reused = false;

  const paymentRequest = await prisma.$transaction(async (tx) => {
    await lockActionPaymentLifecycle(tx, action.id);
    await lockRecipientPaymentLifecycle(tx, action);
    if (action.type === ActionType.KASPA_INVOICE) {
      const invoice = await tx.action.findUnique({
        select: { invoicePaidAt: true },
        where: { id: action.id },
      });
      if (invoice?.invoicePaidAt) return null;
    }
    // A reload or the wallet app sending the browser back asks again. A second
    // open request for the same address and amount would leave the payment
    // ambiguous and unconfirmed, so the payer's open request is extended
    // instead.
    const reusableId =
      plainRequest && ipHash
        ? await findReusableRequestId(tx, {
            actionId: action.id,
            amountSompi,
            ipHash,
            requestedMessage,
          })
        : null;
    if (reusableId) {
      reused = true;
      return tx.paymentRequest.update({
        data: { detectionAttempts: 0, expiresAt, nextDetectionAt: new Date() },
        where: { id: reusableId },
      });
    }
    return tx.paymentRequest.create({
      data: {
        actionId: action.id,
        amountSompi,
        expiresAt,
        network: action.network,
        paymentUri,
        recipientAddress: action.recipientAddress,
        requestedMessage,
        supporterMessage,
        supporterName,
        supporterPublic,
      },
    });
  });
  if (!paymentRequest) {
    return apiError(
      ErrorCodes.INVOICE_PAID,
      "This invoice has already been paid and cannot accept another payment request.",
      409,
    );
  }

  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.PUBLIC,
    event: reused ? "payment_request.reused" : "payment_request.created",
    ipHash,
    metadata: {
      publicId: action.publicId,
      variableAmount: amountSompi === null,
    },
    paymentRequestId: paymentRequest.id,
  });

  return apiJson({ paymentRequest: serializePaymentRequest(paymentRequest) }, reused ? 200 : 201);
}

/** The newest open plain request for this link and amount that the same client created. */
async function findReusableRequestId(
  tx: Prisma.TransactionClient,
  input: {
    actionId: string;
    amountSompi: bigint | null;
    ipHash: string;
    requestedMessage: null | string;
  },
): Promise<null | string> {
  const open = await tx.paymentRequest.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true },
    take: 10,
    where: {
      actionId: input.actionId,
      amountSompi: input.amountSompi,
      expiresAt: { gt: new Date() },
      requestedMessage: input.requestedMessage,
      status: PaymentRequestStatus.PENDING,
      supporterMessage: null,
      supporterName: null,
      supporterPublic: false,
    },
  });
  if (open.length === 0) return null;
  const sameClient = await tx.auditLog.findFirst({
    orderBy: { createdAt: "desc" },
    select: { paymentRequestId: true },
    where: {
      event: "payment_request.created",
      ipHash: input.ipHash,
      paymentRequestId: { in: open.map((request) => request.id) },
    },
  });
  return sameClient?.paymentRequestId ?? null;
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
