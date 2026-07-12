import { PaymentRequestStatus, prisma } from "@kaspa-actions/db";

import { requireCreator } from "@/lib/creator-guard";
import { apiJson, apiMethodNotAllowed } from "@/lib/errors";
import { syncOperatorPageViewsFromAccessLogs } from "@/lib/operator-stats";

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_WINDOW_DAYS = 90;
const REFERRER_LIMIT = 3;

type CreatorAnalyticsAction = {
  disabledAt: Date | null;
  id: string;
  publicId: string;
  slug: string | null;
};

type AnalyticsBucket = {
  confirmedPayments: {
    last7d: number;
    total: number;
  };
  conversion: {
    confirmedFromViewRate: number;
    requestFromViewRate: number;
  };
  paymentRequests: {
    last7d: number;
    total: number;
  };
  referrers: Array<{
    count: number;
    label: string;
  }>;
  uniqueVisitors: {
    last7d: number;
    total: number;
  };
  views: {
    last7d: number;
    total: number;
  };
};

type MutableAnalyticsBucket = AnalyticsBucket & {
  referrerCounts: Map<string, number>;
  uniqueVisitorKeys: Set<string>;
  uniqueVisitorKeys7d: Set<string>;
};

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const now = new Date();
  const cutoff7d = new Date(now.getTime() - 7 * DAY_MS);
  const cutoffWindow = new Date(now.getTime() - ANALYTICS_WINDOW_DAYS * DAY_MS);

  // Best-effort refresh from the local Caddy access logs. If the logs are
  // unavailable in a local/dev shell, the route still returns whatever has
  // already been persisted in OperatorPageView.
  const source = await syncOperatorPageViewsFromAccessLogs(prisma);

  const actions = await prisma.action.findMany({
    select: {
      disabledAt: true,
      id: true,
      publicId: true,
      slug: true,
    },
    where: {
      creatorId: guard.creator.id,
      deletedAt: null,
    },
  });

  if (actions.length === 0) {
    return apiJson({
      analytics: {},
      source: {
        computedAt: now.toISOString(),
        filesRead: source.filesRead,
        linesParsed: source.linesParsed,
        storage: source.storage,
        windowDays: ANALYTICS_WINDOW_DAYS,
      },
    });
  }

  const pathsByActionId = buildTrackedPathsByActionId({
    actions,
    profileTipActionId: guard.creator.tipActionId,
    username: guard.creator.username,
  });
  const actionIdByPath = new Map<string, string>();
  for (const [actionId, paths] of pathsByActionId) {
    for (const path of paths) {
      actionIdByPath.set(path, actionId);
    }
  }

  const buckets = new Map<string, MutableAnalyticsBucket>();
  for (const action of actions) {
    buckets.set(action.id, createBucket());
  }

  const trackedPaths = Array.from(actionIdByPath.keys());
  const actionIds = actions.map((action) => action.id);
  const pageViewWhere = {
    isBot: false,
    path: {
      in: trackedPaths,
    },
    seenAt: {
      gte: cutoffWindow,
    },
    status: {
      gte: 200,
      lt: 400,
    },
  };
  const paymentWhere = {
    actionId: {
      in: actionIds,
    },
    createdAt: {
      gte: cutoffWindow,
    },
  };

  const [
    pageViewCounts,
    pageViewCounts7d,
    uniqueVisitorRows,
    uniqueVisitorRows7d,
    referrerRows,
    paymentCounts,
    paymentCounts7d,
  ] = await Promise.all([
    prisma.operatorPageView.groupBy({
      _count: { _all: true },
      by: ["path"],
      where: pageViewWhere,
    }),
    prisma.operatorPageView.groupBy({
      _count: { _all: true },
      by: ["path"],
      where: {
        ...pageViewWhere,
        seenAt: {
          gte: cutoff7d,
        },
      },
    }),
    prisma.operatorPageView.groupBy({
      by: ["path", "visitorDayHash"],
      where: pageViewWhere,
    }),
    prisma.operatorPageView.groupBy({
      by: ["path", "visitorDayHash"],
      where: {
        ...pageViewWhere,
        seenAt: {
          gte: cutoff7d,
        },
      },
    }),
    prisma.operatorPageView.groupBy({
      _count: { _all: true },
      by: ["path", "referrer"],
      where: pageViewWhere,
    }),
    prisma.paymentRequest.groupBy({
      _count: { _all: true },
      by: ["actionId", "status"],
      where: paymentWhere,
    }),
    prisma.paymentRequest.groupBy({
      _count: { _all: true },
      by: ["actionId", "status"],
      where: {
        ...paymentWhere,
        createdAt: {
          gte: cutoff7d,
        },
      },
    }),
  ]);

  for (const row of pageViewCounts) {
    const actionId = actionIdByPath.get(row.path);
    if (!actionId) continue;
    const bucket = buckets.get(actionId);
    if (!bucket) continue;

    bucket.views.total += row._count._all;
  }

  for (const row of pageViewCounts7d) {
    const actionId = actionIdByPath.get(row.path);
    if (!actionId) continue;
    const bucket = buckets.get(actionId);
    if (!bucket) continue;

    bucket.views.last7d += row._count._all;
  }

  for (const row of uniqueVisitorRows) {
    const actionId = actionIdByPath.get(row.path);
    if (!actionId) continue;
    const bucket = buckets.get(actionId);
    if (!bucket) continue;

    bucket.uniqueVisitorKeys.add(row.visitorDayHash);
  }

  for (const row of uniqueVisitorRows7d) {
    const actionId = actionIdByPath.get(row.path);
    if (!actionId) continue;
    const bucket = buckets.get(actionId);
    if (!bucket) continue;

    bucket.uniqueVisitorKeys7d.add(row.visitorDayHash);
  }

  for (const row of referrerRows) {
    const actionId = actionIdByPath.get(row.path);
    if (!actionId) continue;
    const bucket = buckets.get(actionId);
    if (!bucket) continue;

    incrementMap(bucket.referrerCounts, normalizeReferrer(row.referrer), row._count._all);
  }

  for (const row of paymentCounts) {
    const bucket = buckets.get(row.actionId);
    if (!bucket) continue;

    bucket.paymentRequests.total += row._count._all;

    if (row.status === PaymentRequestStatus.CONFIRMED) {
      bucket.confirmedPayments.total += row._count._all;
    }
  }

  for (const row of paymentCounts7d) {
    const bucket = buckets.get(row.actionId);
    if (!bucket) continue;

    bucket.paymentRequests.last7d += row._count._all;

    if (row.status === PaymentRequestStatus.CONFIRMED) {
      bucket.confirmedPayments.last7d += row._count._all;
    }
  }

  const actionById = new Map(actions.map((action) => [action.id, action]));
  const analytics = Object.fromEntries(
    Array.from(buckets.entries()).map(([actionId, bucket]) => {
      const action = actionById.get(actionId);
      return [action?.publicId ?? actionId, finalizeBucket(bucket)];
    }),
  );

  return apiJson({
    analytics,
    source: {
      computedAt: now.toISOString(),
      filesRead: source.filesRead,
      linesParsed: source.linesParsed,
      storage: source.storage,
      windowDays: ANALYTICS_WINDOW_DAYS,
    },
  });
}

export function POST() {
  return apiMethodNotAllowed(["GET"]);
}

function buildTrackedPathsByActionId({
  actions,
  profileTipActionId,
  username,
}: {
  actions: CreatorAnalyticsAction[];
  profileTipActionId: string | null;
  username: string;
}): Map<string, Set<string>> {
  const pathsByActionId = new Map<string, Set<string>>();
  const encodedUsername = encodeURIComponent(username);

  for (const action of actions) {
    const paths = new Set<string>([`/a/${encodeURIComponent(action.publicId)}`]);
    if (action.slug) {
      paths.add(`/u/${encodedUsername}/${encodeURIComponent(action.slug)}`);
    }
    if (action.id === profileTipActionId && action.disabledAt === null) {
      paths.add(`/u/${encodedUsername}`);
    }
    pathsByActionId.set(action.id, paths);
  }

  return pathsByActionId;
}

function createBucket(): MutableAnalyticsBucket {
  return {
    confirmedPayments: {
      last7d: 0,
      total: 0,
    },
    conversion: {
      confirmedFromViewRate: 0,
      requestFromViewRate: 0,
    },
    paymentRequests: {
      last7d: 0,
      total: 0,
    },
    referrerCounts: new Map<string, number>(),
    referrers: [],
    uniqueVisitorKeys: new Set<string>(),
    uniqueVisitorKeys7d: new Set<string>(),
    uniqueVisitors: {
      last7d: 0,
      total: 0,
    },
    views: {
      last7d: 0,
      total: 0,
    },
  };
}

function finalizeBucket(bucket: MutableAnalyticsBucket): AnalyticsBucket {
  return {
    confirmedPayments: bucket.confirmedPayments,
    conversion: {
      confirmedFromViewRate: ratio(bucket.confirmedPayments.total, bucket.views.total),
      requestFromViewRate: ratio(bucket.paymentRequests.total, bucket.views.total),
    },
    paymentRequests: bucket.paymentRequests,
    referrers: Array.from(bucket.referrerCounts.entries())
      .map(([label, count]) => ({ count, label }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, REFERRER_LIMIT),
    uniqueVisitors: {
      last7d: bucket.uniqueVisitorKeys7d.size,
      total: bucket.uniqueVisitorKeys.size,
    },
    views: bucket.views,
  };
}

function incrementMap(map: Map<string, number>, key: string, increment = 1): void {
  map.set(key, (map.get(key) ?? 0) + increment);
}

function normalizeReferrer(referrer: string): string {
  if (!referrer || referrer === "-") {
    return "Direct";
  }

  try {
    const parsed = new URL(referrer);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return referrer.slice(0, 80);
  }
}

function ratio(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number((part / total).toFixed(4));
}
