import { AuditActorType, PaymentRequestStatus, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { z } from "zod";

import { hashManageToken, MANAGE_TOKEN_HEADER } from "@/lib/account-free-links";
import { serializeAccountFreeAction } from "@/lib/action-serializer";
import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

// The private manage link of an account-free payment link. The token is the only
// credential: whoever holds the link can see payments, pause or delete the link.
// Once an account adopts the link, the token is cleared and this route says 404.

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

const RECENT_PAYMENTS = 20;
const patchSchema = z.object({ disabled: z.boolean() }).strict();

async function authorize(request: Request, context: RouteContext) {
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.ACCOUNT_FREE_LINK_MANAGE, ipHash);
  if (!limited.allowed) return { ok: false as const, response: limited.response };

  const { publicId } = await context.params;
  const manageTokenHash = hashManageToken(request.headers.get(MANAGE_TOKEN_HEADER));
  const action =
    manageTokenHash && publicId.length <= 64
      ? await prisma.action.findFirst({
          where: { creatorId: null, deletedAt: null, manageTokenHash, publicId },
        })
      : null;
  if (!action) {
    return {
      ok: false as const,
      response: apiError(ErrorCodes.NOT_FOUND, "Link not found or no longer managed here.", 404),
    };
  }
  return { action, ipHash, ok: true as const };
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);
  if (!auth.ok) return auth.response;
  const { action } = auth;

  const where = { actionId: action.id, status: PaymentRequestStatus.CONFIRMED };
  const [totals, recent] = await Promise.all([
    prisma.paymentRequest.aggregate({ _count: { _all: true }, _sum: { amountSompi: true }, where }),
    prisma.paymentRequest.findMany({
      orderBy: { confirmedAt: "desc" },
      select: {
        amountSompi: true,
        confirmedAt: true,
        supporterMessage: true,
        supporterName: true,
        txId: true,
      },
      take: RECENT_PAYMENTS,
      where,
    }),
  ]);

  return apiJson({
    action: serializeAccountFreeAction(action),
    payments: {
      confirmedCount: totals._count._all,
      recent: recent.map((payment) => ({
        amountKas: payment.amountSompi !== null ? formatSompiToKaspa(payment.amountSompi) : null,
        confirmedAt: payment.confirmedAt?.toISOString() ?? null,
        supporterMessage: payment.supporterMessage,
        supporterName: payment.supporterName,
        txId: payment.txId,
      })),
      // formatSompiToKaspa rejects zero, and a new link has no payments yet.
      totalKas: totals._sum.amountSompi ? formatSompiToKaspa(totals._sum.amountSompi) : "0",
    },
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);
  if (!auth.ok) return auth.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, "Send { disabled: true | false }.", 400);
  }

  const action = await prisma.action.update({
    data: { disabledAt: parsed.data.disabled ? new Date() : null },
    where: { id: auth.action.id },
  });
  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.PUBLIC,
    event: parsed.data.disabled ? "action.account_free_disabled" : "action.account_free_enabled",
    ipHash: auth.ipHash,
  });
  return apiJson({ action: serializeAccountFreeAction(action) });
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await authorize(request, context);
  if (!auth.ok) return auth.response;

  const now = new Date();
  await prisma.action.update({
    data: { deletedAt: now, disabledAt: auth.action.disabledAt ?? now, manageTokenHash: null },
    where: { id: auth.action.id },
  });
  await writeAuditLog(prisma, {
    actionId: auth.action.id,
    actorType: AuditActorType.PUBLIC,
    event: "action.account_free_deleted",
    ipHash: auth.ipHash,
  });
  return apiJson({ deleted: true });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "PATCH", "DELETE"]);

export { methodNotAllowed as POST, methodNotAllowed as PUT };
