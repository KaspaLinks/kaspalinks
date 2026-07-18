import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

import { prisma } from "@kaspa-actions/db";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SOMPI_PER_KAS = 100_000_000n;
const RECENT_LIMIT = 10;

// Normalize Prisma's client-side enum name (KASPA_TIP) to the protocol form
// (kaspa.tip) so the API surfaces consistent values regardless of whether a
// field came from $queryRaw (DB value) or the typed client (enum name).
const PROTOCOL_TYPE: Record<string, string> = {
  KASPA_CLAIMABLE: "kaspa.claimable",
  KASPA_DONATION: "kaspa.donation",
  KASPA_GOAL: "kaspa.goal",
  KASPA_INVOICE: "kaspa.invoice",
  KASPA_TIP: "kaspa.tip",
  KASPA_TRANSFER: "kaspa.transfer",
};

function toProtocolType(type: string): string {
  return PROTOCOL_TYPE[type] ?? type;
}

type StatsResponse = {
  activeCreators: number;
  activeCreatorsDelta7d: number;
  computedAt: string;
  confirmedPayments: number;
  confirmedPaymentsDelta7d: number;
  linkTypeBreakdown: Record<string, number>;
  recentConfirmations: Array<{
    amountKas: null | string;
    confirmedAt: null | string;
    txId: null | string;
    type: string;
  }>;
  totalKasReceived: string;
  totalKasReceivedDelta7d: string;
  totalLinks: number;
  totalLinksDelta7d: number;
};

function formatSompiAsKas(sompi: bigint | null): string {
  if (sompi === null || sompi === 0n) return "0";
  const whole = sompi / SOMPI_PER_KAS;
  const decimal = sompi % SOMPI_PER_KAS;
  if (decimal === 0n) return whole.toString();
  const decimalStr = decimal.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${decimalStr}`;
}

async function loadStats(): Promise<StatsResponse> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  // Confirmed payments are historical events. Deleting the public link later
  // must not make the all-time KAS/payment totals move backwards.
  const aggregateRows = await prisma.$queryRaw<
    Array<{ kind: string; payments: bigint; sompi: bigint | null }>
  >`
    WITH confirmed_events AS (
      SELECT pr."amountSompi"::bigint AS "amountSompi",
             pr."confirmedAt" AS "confirmedAt"
      FROM "PaymentRequest" pr
      JOIN "Action" a ON pr."actionId" = a.id
      WHERE pr.status = 'CONFIRMED'
        AND pr.network = 'MAINNET'
        AND (pr."detectionSource" IS NULL OR pr."detectionSource" != 'mock')
      UNION ALL
      SELECT GREATEST(cl."amountSompi" - cl."feeSompi", 0)::bigint AS "amountSompi",
             COALESCE(cl."claimedAt", cl."updatedAt") AS "confirmedAt"
      FROM "ClaimableLink" cl
      WHERE cl.status = 'claimed'
        AND cl.network = 'MAINNET'
    )
    SELECT 'all_time'::text AS kind,
           COUNT(*)::bigint AS payments,
           SUM("amountSompi")::bigint AS sompi
    FROM confirmed_events
    UNION ALL
    SELECT 'last_7d'::text AS kind,
           COUNT(*)::bigint AS payments,
           SUM("amountSompi")::bigint AS sompi
    FROM confirmed_events
    WHERE "confirmedAt" >= ${sevenDaysAgo}
  `;
  const allTime = aggregateRows.find((row) => row.kind === "all_time");
  const last7d = aggregateRows.find((row) => row.kind === "last_7d");

  const [
    actionLinks,
    claimableLinks,
    actionLinksDelta7d,
    claimableLinksDelta7d,
    activeCreators,
    newCreators7d,
    typeBreakdown,
    recent,
  ] = await Promise.all([
    // "Links created" is historical. Soft-deleting a public URL removes it
    // from creator tools and public lookup, but not from this aggregate.
    prisma.action.count({ where: { network: "MAINNET" } }),
    prisma.claimableLink.count({ where: { network: "MAINNET" } }),
    prisma.action.count({
      where: { createdAt: { gte: sevenDaysAgo }, network: "MAINNET" },
    }),
    prisma.claimableLink.count({
      where: { createdAt: { gte: sevenDaysAgo }, network: "MAINNET" },
    }),
    prisma.creator.count({
      where: {
        OR: [
          { actions: { some: { deletedAt: null, network: "MAINNET" } } },
          { claimableLinks: { some: { deletedAt: null, network: "MAINNET" } } },
        ],
      },
    }),
    // Creators with at least one undeleted action created in the last 7d —
    // aligns with "active creators" so the delta never exceeds the total
    // and never counts orphan signups.
    prisma.creator.count({
      where: {
        OR: [
          {
            actions: {
              some: { createdAt: { gte: sevenDaysAgo }, deletedAt: null, network: "MAINNET" },
            },
          },
          {
            claimableLinks: {
              some: { createdAt: { gte: sevenDaysAgo }, deletedAt: null, network: "MAINNET" },
            },
          },
        ],
      },
    }),
    prisma.$queryRaw<Array<{ count: bigint; type: string }>>`
        SELECT type, COUNT(*)::bigint AS count
        FROM (
          SELECT a.type::text AS type
          FROM "PaymentRequest" pr
          JOIN "Action" a ON pr."actionId" = a.id
          WHERE pr.status = 'CONFIRMED'
            AND pr.network = 'MAINNET'
            AND (pr."detectionSource" IS NULL OR pr."detectionSource" != 'mock')
          UNION ALL
          SELECT 'kaspa.claimable'::text AS type
          FROM "ClaimableLink" cl
          WHERE cl.status = 'claimed'
            AND cl.network = 'MAINNET'
        ) confirmed_by_type
        GROUP BY type
      `,
    prisma.$queryRaw<
      Array<{
        amountSompi: bigint | null;
        confirmedAt: Date | null;
        network: string;
        txId: null | string;
        type: string;
      }>
    >`
        SELECT "amountSompi", "confirmedAt", network, "txId", type
        FROM (
          SELECT pr."amountSompi"::bigint AS "amountSompi",
                 pr."confirmedAt" AS "confirmedAt",
                 pr.network::text AS network,
                 pr."txId" AS "txId",
                 a.type::text AS type,
                 pr."createdAt" AS "sortCreatedAt"
          FROM "PaymentRequest" pr
          JOIN "Action" a ON pr."actionId" = a.id
          WHERE pr.status = 'CONFIRMED'
            AND pr.network = 'MAINNET'
            AND (pr."detectionSource" IS NULL OR pr."detectionSource" != 'mock')
          UNION ALL
          SELECT GREATEST(cl."amountSompi" - cl."feeSompi", 0)::bigint AS "amountSompi",
                 COALESCE(cl."claimedAt", cl."updatedAt") AS "confirmedAt",
                 cl.network::text AS network,
                 COALESCE(cl."claimTxId", cl."fundingTxId") AS "txId",
                 'kaspa.claimable'::text AS type,
                 cl."createdAt" AS "sortCreatedAt"
          FROM "ClaimableLink" cl
          WHERE cl.status = 'claimed'
            AND cl.network = 'MAINNET'
        ) recent_confirmations
        ORDER BY "confirmedAt" DESC NULLS LAST, "sortCreatedAt" DESC
        LIMIT ${RECENT_LIMIT}
      `,
  ]);
  const totalLinks = actionLinks + claimableLinks;
  const totalLinksDelta7d = actionLinksDelta7d + claimableLinksDelta7d;

  return {
    activeCreators,
    activeCreatorsDelta7d: newCreators7d,
    computedAt: now.toISOString(),
    confirmedPayments: Number(allTime?.payments ?? 0n),
    confirmedPaymentsDelta7d: Number(last7d?.payments ?? 0n),
    linkTypeBreakdown: Object.fromEntries(
      typeBreakdown.map(({ count, type }) => [toProtocolType(type), Number(count)]),
    ),
    recentConfirmations: recent.map((pr) => ({
      amountKas: pr.amountSompi !== null ? formatSompiAsKas(pr.amountSompi) : null,
      confirmedAt: pr.confirmedAt?.toISOString() ?? null,
      txId: pr.txId,
      type: toProtocolType(pr.type),
    })),
    totalKasReceived: formatSompiAsKas(allTime?.sompi ?? null),
    totalKasReceivedDelta7d: formatSompiAsKas(last7d?.sompi ?? null),
    totalLinks,
    totalLinksDelta7d,
  };
}

// Deduplicate the heavy aggregate query across concurrent requests for a
// 60-second window. Multiple users on /stats trigger ONE DB roundtrip per
// minute instead of one per request.
const getCachedStats = unstable_cache(loadStats, ["public-stats"], { revalidate: 60 });

export async function GET(): Promise<NextResponse> {
  try {
    const stats = await getCachedStats();
    return NextResponse.json(stats, {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    console.error("Failed to compute public stats:", error);
    return NextResponse.json(
      { error: { code: "STATS_UNAVAILABLE", message: "Stats temporarily unavailable." } },
      { status: 503 },
    );
  }
}
