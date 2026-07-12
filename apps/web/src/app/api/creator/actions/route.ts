import { prisma } from "@kaspa-actions/db";
import { ActionType, AuditActorType, Network } from "@kaspa-actions/db";
import {
  formatSompiToKaspa,
  parseKaspaAmountToSompi,
  parseSompiAmount,
} from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import {
  readCreatorActionDailyLimit,
  rollingDailyWindowStart,
  serializeSafeCreator,
} from "@/lib/creator-auth";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { createCreatorActionInputSchema, formatZodErrorMessage } from "@/lib/schemas";

const ACTION_TYPE_MAP: Record<string, ActionType> = {
  "kaspa.donation": ActionType.KASPA_DONATION,
  "kaspa.goal": ActionType.KASPA_GOAL,
  "kaspa.invoice": ActionType.KASPA_INVOICE,
  "kaspa.tip": ActionType.KASPA_TIP,
  "kaspa.transfer": ActionType.KASPA_TRANSFER,
};

const PUBLIC_ACTION_TYPE_BY_PRISMA_TYPE: Record<ActionType, string> = {
  [ActionType.KASPA_DONATION]: "kaspa.donation",
  [ActionType.KASPA_GOAL]: "kaspa.goal",
  [ActionType.KASPA_INVOICE]: "kaspa.invoice",
  [ActionType.KASPA_TIP]: "kaspa.tip",
  [ActionType.KASPA_TRANSFER]: "kaspa.transfer",
};

const MAX_SLUG_LENGTH = 64;
const MAX_SLUG_SUFFIX_ATTEMPTS = 50;

function buildSlugCandidate(baseSlug: string, attempt: number): string {
  if (attempt === 0) {
    return baseSlug;
  }

  const suffix = `-${attempt + 1}`;
  const prefix = baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/[-_]+$/, "");
  return `${prefix || baseSlug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
}

async function findAvailableCreatorSlug(creatorId: string, requestedSlug: string) {
  for (let attempt = 0; attempt < MAX_SLUG_SUFFIX_ATTEMPTS; attempt += 1) {
    const candidate = buildSlugCandidate(requestedSlug, attempt);
    const existingSlug = await prisma.action.findFirst({
      where: { creatorId, slug: candidate },
    });
    if (!existingSlug) {
      return candidate;
    }
  }

  return null;
}

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

  const data = parsed.data;
  const slug = await findAvailableCreatorSlug(guard.creator.id, data.slug);
  if (slug === null) {
    return apiError(
      ErrorCodes.SLUG_TAKEN,
      "Could not find an available URL slug. Try a more specific title or slug.",
      409,
    );
  }

  const hasKas = typeof data.amountKas === "string" && data.amountKas.length > 0;
  const hasSompi = typeof data.amountSompi === "string" && data.amountSompi.length > 0;
  const amountSompi = hasKas
    ? parseKaspaAmountToSompi(data.amountKas as string)
    : hasSompi
      ? parseSompiAmount(data.amountSompi as string)
      : null;

  // Goal target for crowdfunding links — schema guarantees it's present
  // for kaspa.goal and absent otherwise, so this resolves to a positive
  // BigInt for goals and null for every other type.
  const hasGoalKas = typeof data.goalKas === "string" && data.goalKas.length > 0;
  const hasGoalSompi = typeof data.goalSompi === "string" && data.goalSompi.length > 0;
  const goalSompi = hasGoalKas
    ? parseKaspaAmountToSompi(data.goalKas as string)
    : hasGoalSompi
      ? parseSompiAmount(data.goalSompi as string)
      : null;

  // Smart per-type default for profile visibility — invoice/transfer
  // tend to be 1-recipient-specific (custom amount, customer name in
  // title, ...) so we hide them from /u/<username> unless the creator
  // explicitly opts in. Tip + donation default to visible since the
  // whole point is broad reach. The creator can flip this in /new-link.
  const prismaType = ACTION_TYPE_MAP[data.type] as ActionType;
  const typeDefaultsToHidden =
    prismaType === ActionType.KASPA_INVOICE || prismaType === ActionType.KASPA_TRANSFER;
  const hiddenFromProfile = data.hiddenFromProfile ?? typeDefaultsToHidden;
  const shouldOfferAsInitialQuickTip =
    guard.creator.tipActionId === null &&
    !hiddenFromProfile &&
    (await prisma.action.count({
      where: {
        creatorId: guard.creator.id,
        deletedAt: null,
        disabledAt: null,
        hiddenFromProfile: false,
      },
    })) === 0;

  let action;
  try {
    action = await prisma.action.create({
      data: {
        amountSompi,
        creatorId: guard.creator.id,
        description: data.description ?? null,
        expiresAt: data.expiresAt ?? null,
        goalAutoClose: data.type === "kaspa.goal" ? (data.goalAutoClose ?? false) : false,
        goalSompi,
        hiddenFromProfile,
        message: data.message ?? null,
        network: Network.MAINNET,
        noteRequired: data.noteRequired ?? false,
        recipientAddress: data.recipientAddress,
        slug,
        title: data.title,
        type: prismaType,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error, ["creatorId", "slug"])) {
      return apiError(ErrorCodes.SLUG_TAKEN, "Action slug is already used by this creator.", 409);
    }

    throw error;
  }

  // Zero-friction onboarding: the first visible active link a creator
  // creates becomes the large profile card automatically. We do not
  // overwrite an existing profile choice, and hidden invoice/transfer
  // links stay hidden unless the creator explicitly opts them in.
  let quickTipAutoAssigned = false;
  if (shouldOfferAsInitialQuickTip) {
    const updateResult = await prisma.creator.updateMany({
      data: { tipActionId: action.id },
      where: { id: guard.creator.id, tipActionId: null },
    });
    quickTipAutoAssigned = updateResult.count > 0;
  }

  await writeAuditLog(prisma, {
    actionId: action.id,
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "creator.action_created",
    ipHash: guard.ipHash,
    metadata: {
      publicId: action.publicId,
      quickTipAutoAssigned,
      slug: action.slug,
      type: action.type,
      username: guard.creator.username,
      variableAmount: amountSompi === null,
    },
  });

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
