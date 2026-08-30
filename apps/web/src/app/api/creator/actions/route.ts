import { prisma } from "@kaspa-actions/db";
import { ActionType, AuditActorType, Network } from "@kaspa-actions/db";
import { actorContext, ApplicationError, createActionTool } from "@kaspa-actions/application";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import {
  readCreatorActionDailyLimit,
  rollingDailyWindowStart,
  serializeSafeCreator,
} from "@/lib/creator-auth";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { createCreatorActionInputSchema, formatZodErrorMessage } from "@/lib/schemas";

const PUBLIC_ACTION_TYPE_BY_PRISMA_TYPE: Record<ActionType, string> = {
  [ActionType.KASPA_DONATION]: "kaspa.donation",
  [ActionType.KASPA_GOAL]: "kaspa.goal",
  [ActionType.KASPA_INVOICE]: "kaspa.invoice",
  [ActionType.KASPA_TIP]: "kaspa.tip",
  [ActionType.KASPA_TRANSFER]: "kaspa.transfer",
};

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const actions = await prisma.action.findMany({
    orderBy: { createdAt: "desc" },
    where: { creatorId: guard.creator.id, deletedAt: null },
  });

  return apiJson({
    actions: actions.map((action) => serializeCreatorAction(action, guard.creator.username)),
    creator: serializeSafeCreator(guard.creator),
  });
}

export async function POST(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.CREATOR_ACTION_CREATE, guard.creator.id);
  if (!limited.allowed) return limited.response;

  const dailyLimit = readCreatorActionDailyLimit();
  const recentCount = await prisma.action.count({
    where: {
      createdAt: { gte: rollingDailyWindowStart() },
      creatorId: guard.creator.id,
    },
  });

  if (recentCount >= dailyLimit) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "creator.action_daily_limit_exceeded",
      ipHash: guard.ipHash,
      metadata: { dailyLimit },
    });

    return apiError(ErrorCodes.RATE_LIMITED, "Daily Action creation limit reached.", 429);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = createCreatorActionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

  let action;
  try {
    action = await createActionTool(prisma, actorContext(guard.creator.id, "web"), parsed.data, {
      dailyLimit,
      ipHash: guard.ipHash,
    });
  } catch (error) {
    if (error instanceof ApplicationError) {
      const code =
        error.code === "SLUG_TAKEN"
          ? ErrorCodes.SLUG_TAKEN
          : error.code === "ACTION_LIMIT_REACHED"
            ? ErrorCodes.RATE_LIMITED
            : ErrorCodes.INVALID_BODY;
      return apiError(code, error.message, error.status);
    }
    throw error;
  }

  return apiJson(
    {
      action: serializeCreatorAction(action, guard.creator.username),
    },
    201,
  );
}

function serializeCreatorAction(
  action: {
    amountSompi: bigint | null;
    createdAt: Date;
    deletedAt?: Date | null;
    description: string | null;
    disabledAt: Date | null;
    goalSompi: bigint | null;
    goalAutoClose: boolean;
    hiddenFromProfile: boolean;
    id: string;
    message: string | null;
    network: Network;
    noteRequired: boolean;
    publicId: string;
    recipientAddress: string;
    slug: string | null;
    title: string;
    type: ActionType;
    updatedAt: Date;
  },
  username: string,
) {
  const sharePath =
    action.slug === null
      ? `/a/${encodeURIComponent(action.publicId)}`
      : `/u/${encodeURIComponent(username)}/${encodeURIComponent(action.slug)}`;

  return {
    amountKas: action.amountSompi !== null ? formatSompiToKaspa(action.amountSompi) : null,
    amountSompi: action.amountSompi !== null ? action.amountSompi.toString() : null,
    createdAt: action.createdAt.toISOString(),
    description: action.description,
    disabledAt: action.disabledAt ? action.disabledAt.toISOString() : null,
    goalAutoClose: action.goalAutoClose,
    goalKas: action.goalSompi !== null ? formatSompiToKaspa(action.goalSompi) : null,
    goalSompi: action.goalSompi !== null ? action.goalSompi.toString() : null,
    hiddenFromProfile: action.hiddenFromProfile,
    // Internal id is safe to echo here because this endpoint already
    // requires creator-token auth; the only consumer is the creator's
    // own dashboard where it's used to keep the tipActionId selection
    // in sync. Never returned by the public /a/[publicId] route.
    id: action.id,
    message: action.message,
    network: action.network === Network.TESTNET ? "testnet" : "mainnet",
    noteRequired: action.noteRequired,
    publicId: action.publicId,
    recipientAddress: action.recipientAddress,
    sharePath,
    slug: action.slug,
    title: action.title,
    type: PUBLIC_ACTION_TYPE_BY_PRISMA_TYPE[action.type],
    updatedAt: action.updatedAt.toISOString(),
  };
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "POST"]);

export { methodNotAllowed as DELETE, methodNotAllowed as PATCH, methodNotAllowed as PUT };
