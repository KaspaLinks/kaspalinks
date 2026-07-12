import { prisma } from "@kaspa-actions/db";
import { ActionType, AuditActorType, Network } from "@kaspa-actions/db";
import {
  formatSompiToKaspa,
  parseKaspaAmountToSompi,
  parseSompiAmount,
} from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { formatZodErrorMessage, updateCreatorActionInputSchema } from "@/lib/schemas";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

const PUBLIC_ACTION_TYPE_BY_PRISMA_TYPE: Record<ActionType, string> = {
  [ActionType.KASPA_DONATION]: "kaspa.donation",
  [ActionType.KASPA_GOAL]: "kaspa.goal",
  [ActionType.KASPA_INVOICE]: "kaspa.invoice",
  [ActionType.KASPA_TIP]: "kaspa.tip",
  [ActionType.KASPA_TRANSFER]: "kaspa.transfer",
};

const FIXED_AMOUNT_TYPES = new Set<ActionType>([
  ActionType.KASPA_INVOICE,
  ActionType.KASPA_TRANSFER,
]);

export async function PATCH(request: Request, context: RouteContext) {
  const { publicId } = await context.params;
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = updateCreatorActionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }

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

  const updates: {
    amountSompi?: bigint | null;
    description?: string | null;
    disabledAt?: Date | null;
    goalAutoClose?: boolean;
    goalSompi?: bigint;
    hiddenFromProfile?: boolean;
    message?: string | null;
    noteRequired?: boolean;
    title?: string;
  } = {};

  if (parsed.data.disabled !== undefined) {
    updates.disabledAt = parsed.data.disabled ? new Date() : null;
  }
  if (parsed.data.title !== undefined) {
    updates.title = parsed.data.title;
  }
  if (parsed.data.description !== undefined) {
    updates.description = parsed.data.description;
  }
  if (parsed.data.message !== undefined) {
    updates.message = parsed.data.message;
  }
  if (parsed.data.hiddenFromProfile !== undefined) {
    updates.hiddenFromProfile = parsed.data.hiddenFromProfile;
  }
  if (parsed.data.noteRequired !== undefined) {
    updates.noteRequired = parsed.data.noteRequired;
  }
  if (parsed.data.goalAutoClose !== undefined) {
    if (action.type !== ActionType.KASPA_GOAL && parsed.data.goalAutoClose) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "Only goal links can auto-close at the target.",
        400,
      );
    }
    updates.goalAutoClose =
      action.type === ActionType.KASPA_GOAL ? parsed.data.goalAutoClose : false;
  }

  const goalProvided = parsed.data.goalKas !== undefined || parsed.data.goalSompi !== undefined;
  if (goalProvided) {
    const hasGoalKas = typeof parsed.data.goalKas === "string" && parsed.data.goalKas.length > 0;
    const hasGoalSompi =
      typeof parsed.data.goalSompi === "string" && parsed.data.goalSompi.length > 0;

    if (action.type !== ActionType.KASPA_GOAL) {
      return apiError(ErrorCodes.INVALID_BODY, "Only goal links can update a goal target.", 400);
    }

    const goalSompi = hasGoalKas
      ? parseKaspaAmountToSompi(parsed.data.goalKas as string)
      : hasGoalSompi
        ? parseSompiAmount(parsed.data.goalSompi as string)
        : null;

    if (goalSompi === null) {
      return apiError(ErrorCodes.INVALID_BODY, "Goal links require a target amount.", 400);
    }

    updates.goalSompi = goalSompi;
  }

  const amountProvided =
    parsed.data.amountKas !== undefined || parsed.data.amountSompi !== undefined;
  if (amountProvided) {
    const hasKas = typeof parsed.data.amountKas === "string" && parsed.data.amountKas.length > 0;
    const hasSompi =
      typeof parsed.data.amountSompi === "string" && parsed.data.amountSompi.length > 0;

    if (action.type === ActionType.KASPA_GOAL) {
      if (hasKas || hasSompi) {
        return apiError(
          ErrorCodes.INVALID_BODY,
          "Goal links use a target amount, not a fixed payment amount.",
          400,
        );
      }
    } else {
      const amountSompi = hasKas
        ? parseKaspaAmountToSompi(parsed.data.amountKas as string)
        : hasSompi
          ? parseSompiAmount(parsed.data.amountSompi as string)
          : null;

      if (amountSompi === null && FIXED_AMOUNT_TYPES.has(action.type)) {
        return apiError(
          ErrorCodes.INVALID_BODY,
          `${PUBLIC_ACTION_TYPE_BY_PRISMA_TYPE[action.type]} requires a fixed amount.`,
          400,
        );
      }

      updates.amountSompi = amountSompi;
    }
  }

  const updated = await prisma.action.update({
    data: updates,
    where: { id: action.id },
  });

  const updatedFields = Object.keys(updates);
  const event =
    parsed.data.disabled === true
      ? "creator.action_disabled"
      : parsed.data.disabled === false
        ? "creator.action_enabled"
        : "creator.action_updated";

  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event,
    ipHash: guard.ipHash,
    metadata: {
      publicId: action.publicId,
      slug: action.slug,
      updatedFields,
      username: guard.creator.username,
      variableAmount: updated.amountSompi === null,
    },
  });

  return apiJson({
    action: serializeCreatorAction(updated, guard.creator.username),
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { publicId } = await context.params;
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

  const deletedAt = new Date();
  const updated = await prisma.action.update({
    data: {
      deletedAt,
      disabledAt: action.disabledAt ?? deletedAt,
    },
    where: { id: action.id },
  });

  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "creator.action_deleted",
    ipHash: guard.ipHash,
    metadata: {
      publicId: action.publicId,
      slug: action.slug,
      username: guard.creator.username,
    },
  });

  return apiJson({
    action: {
      deletedAt: updated.deletedAt ? updated.deletedAt.toISOString() : null,
      publicId: updated.publicId,
    },
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["DELETE", "PATCH"]);

export { methodNotAllowed as GET, methodNotAllowed as POST, methodNotAllowed as PUT };

function serializeCreatorAction(
  action: {
    amountSompi: bigint | null;
    createdAt: Date;
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
