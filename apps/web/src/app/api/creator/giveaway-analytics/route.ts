import { prisma } from "@kaspa-actions/db";

import { requireCreator } from "@/lib/creator-guard";
import { apiJson, apiMethodNotAllowed } from "@/lib/errors";
import { syncOperatorPageViewsFromAccessLogs } from "@/lib/operator-stats";

const DAY_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_WINDOW_DAYS = 90;
const REFERRER_LIMIT = 3;

type MutableGiveawayAnalytics = {
  referrerCounts: Map<string, number>;
  uniqueVisitorKeys: Set<string>;
  uniqueVisitorKeys7d: Set<string>;
  views: {
    last7d: number;
    total: number;
  };
};

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const now = new Date();
  const cutoff7d = new Date(now.getTime() - 7 * DAY_MS);
  const cutoffWindow = new Date(now.getTime() - ANALYTICS_WINDOW_DAYS * DAY_MS);
  const source = await syncOperatorPageViewsFromAccessLogs(prisma);
  const giveaways = await prisma.giveaway.findMany({
    select: { publicId: true },
    where: { creatorId: guard.creator.id },
  });

  if (giveaways.length === 0) {
    return apiJson({
      analytics: {},
      source: analyticsSource(now, source),
    });
  }

  const giveawayIdByPath = new Map(
    giveaways.map((giveaway) => [
      `/toccata-lab/giveaway/${encodeURIComponent(giveaway.publicId)}`,
      giveaway.publicId,
    ]),
  );
  const trackedPaths = Array.from(giveawayIdByPath.keys());
  const pageViewWhere = {
    isBot: false,
    path: { in: trackedPaths },
    seenAt: { gte: cutoffWindow },
    status: { gte: 200, lt: 400 },
  };

  const [viewRows, viewRows7d, visitorRows, visitorRows7d, referrerRows] = await Promise.all([
    prisma.operatorPageView.groupBy({
      _count: { _all: true },
      by: ["path"],
      where: pageViewWhere,
    }),
    prisma.operatorPageView.groupBy({
      _count: { _all: true },
      by: ["path"],
      where: { ...pageViewWhere, seenAt: { gte: cutoff7d } },
    }),
    prisma.operatorPageView.groupBy({
      by: ["path", "visitorDayHash"],
      where: pageViewWhere,
    }),
    prisma.operatorPageView.groupBy({
      by: ["path", "visitorDayHash"],
      where: { ...pageViewWhere, seenAt: { gte: cutoff7d } },
    }),
    prisma.operatorPageView.groupBy({
      _count: { _all: true },
      by: ["path", "referrer"],
      where: pageViewWhere,
    }),
  ]);

  const buckets = new Map<string, MutableGiveawayAnalytics>(
    giveaways.map((giveaway) => [giveaway.publicId, createBucket()]),
  );

  for (const row of viewRows) {
    const bucket = bucketForPath(buckets, giveawayIdByPath, row.path);
    if (bucket) bucket.views.total += row._count._all;
  }
  for (const row of viewRows7d) {
    const bucket = bucketForPath(buckets, giveawayIdByPath, row.path);
    if (bucket) bucket.views.last7d += row._count._all;
  }
  for (const row of visitorRows) {
    const bucket = bucketForPath(buckets, giveawayIdByPath, row.path);
    if (bucket) bucket.uniqueVisitorKeys.add(row.visitorDayHash);
  }
  for (const row of visitorRows7d) {
    const bucket = bucketForPath(buckets, giveawayIdByPath, row.path);
    if (bucket) bucket.uniqueVisitorKeys7d.add(row.visitorDayHash);
  }
  for (const row of referrerRows) {
    const bucket = bucketForPath(buckets, giveawayIdByPath, row.path);
    if (!bucket) continue;
    const label = normalizeReferrer(row.referrer);
    bucket.referrerCounts.set(label, (bucket.referrerCounts.get(label) ?? 0) + row._count._all);
  }

  return apiJson({
    analytics: Object.fromEntries(
      Array.from(buckets.entries()).map(([publicId, bucket]) => [
        publicId,
        {
          referrers: Array.from(bucket.referrerCounts.entries())
            .map(([label, count]) => ({ count, label }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
            .slice(0, REFERRER_LIMIT),
          uniqueVisitors: {
            last7d: bucket.uniqueVisitorKeys7d.size,
            total: bucket.uniqueVisitorKeys.size,
          },
          views: bucket.views,
        },
      ]),
    ),
    source: analyticsSource(now, source),
  });
}

export function POST() {
  return apiMethodNotAllowed(["GET"]);
}

function createBucket(): MutableGiveawayAnalytics {
  return {
    referrerCounts: new Map(),
    uniqueVisitorKeys: new Set(),
    uniqueVisitorKeys7d: new Set(),
    views: { last7d: 0, total: 0 },
  };
}

function bucketForPath(
  buckets: Map<string, MutableGiveawayAnalytics>,
  giveawayIdByPath: Map<string, string>,
  path: string,
): MutableGiveawayAnalytics | undefined {
  const publicId = giveawayIdByPath.get(path);
  return publicId ? buckets.get(publicId) : undefined;
}

function normalizeReferrer(referrer: string): string {
  if (!referrer || referrer === "-") return "Direct";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return referrer.slice(0, 80);
  }
}

function analyticsSource(
  now: Date,
  source: { filesRead: number; linesParsed: number; storage: string },
) {
  return {
    computedAt: now.toISOString(),
    filesRead: source.filesRead,
    linesParsed: source.linesParsed,
    storage: source.storage,
    windowDays: ANALYTICS_WINDOW_DAYS,
  };
}
