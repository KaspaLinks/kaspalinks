import { prisma } from "@kaspa-actions/db";
import { ActionType, AuditActorType, Network } from "@kaspa-actions/db";
import { parseKaspaAmountToSompi, parseSompiAmount } from "@kaspa-actions/kaspa";

import { requireAdmin } from "@/lib/admin-guard";
import { writeAuditLog } from "@/lib/audit";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { createActionInputSchema, formatZodErrorMessage } from "@/lib/schemas";

const ACTION_TYPE_MAP: Record<string, ActionType> = {
  "kaspa.donation": ActionType.KASPA_DONATION,
  "kaspa.goal": ActionType.KASPA_GOAL,
  "kaspa.invoice": ActionType.KASPA_INVOICE,
  "kaspa.tip": ActionType.KASPA_TIP,
  "kaspa.transfer": ActionType.KASPA_TRANSFER,
};

export async function POST(request: Request) {
  const guard = await requireAdmin(request, prisma, {
    event: "admin.create_action_unauthorized",
  });
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.ADMIN_MUTATION, guard.ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = createActionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

  const data = parsed.data;
  const hasKas = typeof data.amountKas === "string" && data.amountKas.length > 0;
  const hasSompi = typeof data.amountSompi === "string" && data.amountSompi.length > 0;
  const amountSompi = hasKas
    ? parseKaspaAmountToSompi(data.amountKas as string)
    : hasSompi
      ? parseSompiAmount(data.amountSompi as string)
      : null;

  const hasGoalKas = typeof data.goalKas === "string" && data.goalKas.length > 0;
  const hasGoalSompi = typeof data.goalSompi === "string" && data.goalSompi.length > 0;
  const goalSompi = hasGoalKas
    ? parseKaspaAmountToSompi(data.goalKas as string)
    : hasGoalSompi
      ? parseSompiAmount(data.goalSompi as string)
      : null;

  const action = await prisma.action.create({
    data: {
      amountSompi,
      description: data.description ?? null,
      expiresAt: data.expiresAt ?? null,
      goalAutoClose: data.type === "kaspa.goal" ? (data.goalAutoClose ?? false) : false,
      goalSompi,
      message: data.message ?? null,
      network: Network.MAINNET,
      recipientAddress: data.recipientAddress,
      title: data.title,
      type: ACTION_TYPE_MAP[data.type] as ActionType,
    },
  });

  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.ADMIN,
    event: "action.created",
    ipHash: guard.ipHash,
    metadata: {
      network: action.network,
      publicId: action.publicId,
      type: action.type,
      variableAmount: amountSompi === null,
    },
  });

  return apiJson(
    {
      action: {
        amountSompi: action.amountSompi ? action.amountSompi.toString() : null,
        createdAt: action.createdAt.toISOString(),
        id: action.id,
        publicId: action.publicId,
        type: action.type,
      },
    },
    201,
  );
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
