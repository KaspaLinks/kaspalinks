import { PaymentRequestStatus, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  decodeSupporterWallCursor,
  encodeSupporterWallCursor,
  formatSupporterWallDate,
  profileActionTypeLabel,
  SUPPORTER_WALL_PAGE_SIZE,
} from "@/lib/supporter-wall";

type RouteContext = {
  params: Promise<{ username: string }>;
};

function parseLimit(request: Request): null | number | Response {
  const rawLimit = new URL(request.url).searchParams.get("limit");
  if (rawLimit === null) return SUPPORTER_WALL_PAGE_SIZE;

  if (!/^\d+$/.test(rawLimit)) {
    return apiError(ErrorCodes.INVALID_BODY, "limit must be a positive integer.", 400);
  }

  const limit = Number.parseInt(rawLimit, 10);
  if (limit < 1 || limit > SUPPORTER_WALL_PAGE_SIZE) {
    return apiError(ErrorCodes.INVALID_BODY, `limit must be between 1 and ${SUPPORTER_WALL_PAGE_SIZE}.`, 400);
  }

  return limit;
}

export async function GET(request: Request, context: RouteContext) {
  const { username } = await context.params;
  const normalized = username.trim().toLowerCase();
  if (!normalized) {
    return apiError(ErrorCodes.NOT_FOUND, "Profile not found.", 404);
  }

  const limit = parseLimit(request);
  if (limit instanceof Response) return limit;
  if (limit === null) {
    return apiError(ErrorCodes.INVALID_BODY, "limit must be a positive integer.", 400);
  }

  const searchParams = new URL(request.url).searchParams;
  const rawCursor = searchParams.get("cursor");
  const cursor = rawCursor ? decodeSupporterWallCursor(rawCursor) : null;
  if (rawCursor && cursor === null) {
    return apiError(ErrorCodes.INVALID_BODY, "cursor is invalid.", 400);
  }

  const creator = await prisma.creator.findUnique({
    select: { id: true, username: true },
    where: { username: normalized },
  });

  if (!creator) {
    return apiError(ErrorCodes.NOT_FOUND, "Profile not found.", 404);
  }

  const entries = await prisma.paymentRequest.findMany({
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
    select: {
      amountSompi: true,
      confirmedAt: true,
      id: true,
      supporterMessage: true,
      supporterName: true,
      action: {
        select: {
          publicId: true,
          slug: true,
          title: true,
          type: true,
        },
      },
    },
    take: limit + 1,
    where: {
      ...(cursor
        ? {
            OR: [
              { confirmedAt: { lt: cursor.confirmedAt } },
              { confirmedAt: cursor.confirmedAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
      action: {
        creatorId: creator.id,
        deletedAt: null,
        hiddenFromProfile: false,
      },
      confirmedAt: { not: null },
      status: PaymentRequestStatus.CONFIRMED,
      supporterHiddenAt: null,
      supporterPublic: true,
    },
  });

  const visibleEntries = entries.slice(0, limit);
  const lastVisible = visibleEntries[visibleEntries.length - 1] ?? null;
  const nextCursor =
    entries.length > limit && lastVisible?.confirmedAt
      ? encodeSupporterWallCursor({
          confirmedAt: lastVisible.confirmedAt,
          id: lastVisible.id,
        })
      : null;

  return apiJson({
    hasMore: entries.length > limit,
    nextCursor,
    supporters: visibleEntries.map((entry) => ({
      actionHref:
        entry.action.slug === null
          ? `/a/${encodeURIComponent(entry.action.publicId)}`
          : `/u/${encodeURIComponent(creator.username)}/${encodeURIComponent(entry.action.slug)}`,
      actionTitle: entry.action.title,
      amountKas: entry.amountSompi !== null ? formatSompiToKaspa(entry.amountSompi) : null,
      dateLabel: formatSupporterWallDate(entry.confirmedAt),
      id: entry.id,
      message: entry.supporterMessage,
      supporterName: entry.supporterName ?? "Anonymous",
      typeLabel: profileActionTypeLabel(entry.action.type),
    })),
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
