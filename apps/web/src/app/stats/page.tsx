import type { Metadata } from "next";
import { unstable_cache } from "next/cache";

import { prisma } from "@kaspa-actions/db";

import { compactSompiAsKas } from "@/app/dashboard/metrics";

export const dynamic = "force-dynamic";
export const revalidate = 60;

const STATS_DESCRIPTION =
  "Live numbers from Kaspa Links — links created, confirmed on-chain payments, KAS received. Updated every minute, no creator identities exposed.";

export const metadata: Metadata = {
  alternates: { canonical: "/stats" },
  description: STATS_DESCRIPTION,
  openGraph: {
    description: STATS_DESCRIPTION,
    title: "Public stats",
    type: "website",
    url: "/stats",
  },
  title: "Public stats",
  twitter: {
    card: "summary_large_image",
    description: STATS_DESCRIPTION,
    title: "Public stats",
  },
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SOMPI_PER_KAS = 100_000_000n;
const RECENT_LIMIT = 10;

// Prisma's enum @map means the database stores "kaspa.tip" but the Prisma
// client surfaces "KASPA_TIP". Raw SQL queries return the DB form, the typed
// client returns the enum name — both end up in this file, so the lookup
// table covers both spellings.
const TYPE_LABEL: Record<string, string> = {
  KASPA_CLAIMABLE: "Claimable",
  KASPA_DONATION: "Donation",
  KASPA_GOAL: "Goal",
  KASPA_INVOICE: "Invoice",
  KASPA_TIP: "Tip",
  KASPA_TRANSFER: "Transfer",
  "kaspa.claimable": "Claimable",
  "kaspa.donation": "Donation",
  "kaspa.goal": "Goal",
  "kaspa.invoice": "Invoice",
  "kaspa.tip": "Tip",
  "kaspa.transfer": "Transfer",
};

function humanType(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

function formatSompiAsKas(sompi: bigint | null): string {
  if (sompi === null || sompi === 0n) return "0";
  const whole = sompi / SOMPI_PER_KAS;
  const decimal = sompi % SOMPI_PER_KAS;
  if (decimal === 0n) return whole.toString();
  const decimalStr = decimal.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${decimalStr}`;
}

function relativeTime(iso: null | string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function compactTxId(txId: null | string): string {
  if (!txId) return "—";
  if (txId.length <= 18) return txId;
  return `${txId.slice(0, 10)}...${txId.slice(-6)}`;
}

function kaspaStreamUrl(txId: null | string): null | string {
  if (!txId || !/^[0-9a-f]+$/i.test(txId)) return null;
  return `https://kaspa.stream/transactions/${encodeURIComponent(txId)}`;
}

// Confirmed payments and created links are historical events. Soft-deleting
// a public link must not make these all-time counters move backwards.
//
// - status: CONFIRMED — obviously
// - detectionSource != 'mock' — exclude mock-confirmed test payments
// - MAINNET-only — the public product is mainnet-only and testnet KAS is faucet play money

async function loadStats() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);

  // Single raw aggregation for historical mainnet confirmations. The Action
  // JOIN supplies the link type but intentionally does not exclude soft-deleted
  // links: a real on-chain payment remains part of the historical total.
  const aggregateRows = await prisma.$queryRaw<
    Array<{
      kind: string;
      payments: bigint;
      sompi: bigint | null;
    }>
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
    prisma.action.count({ where: { network: "MAINNET" } }),
    prisma.claimableLink.count({ where: { network: "MAINNET" } }),
    prisma.action.count({
      where: { createdAt: { gte: sevenDaysAgo }, network: "MAINNET" },
    }),
    prisma.claimableLink.count({ where: { createdAt: { gte: sevenDaysAgo }, network: "MAINNET" } }),
    prisma.creator.count({
      where: {
        OR: [
          { actions: { some: { deletedAt: null, network: "MAINNET" } } },
          { claimableLinks: { some: { deletedAt: null, network: "MAINNET" } } },
        ],
      },
    }),
    // Creators who actually became / stayed active in the last 7 days —
    // anyone with at least one undeleted link created in that window.
    // Using raw signup count would mismatch "active creators" (an account
    // can sign up without ever making a link, or have all their links
    // soft-deleted, and then it shouldn't count toward an "active" delta).
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
    linkTypeBreakdown: typeBreakdown.map((row) => ({
      count: Number(row.count),
      type: row.type,
    })),
    recentConfirmations: recent.map((pr) => ({
      amountKas: pr.amountSompi !== null ? formatSompiAsKas(pr.amountSompi) : null,
      confirmedAt: pr.confirmedAt?.toISOString() ?? null,
      network: pr.network.toLowerCase(),
      txId: pr.txId,
      type: pr.type,
    })),
    // Headline tiles use the compact form (2 decimals / K-M-B) so the value
    // doesn't overflow on mobile; the exact eight-decimal figure rides along
    // for the hover tooltip so the page stays auditable. Per-transaction
    // amounts in "Recent confirmations" keep full precision below.
    totalKasReceived: compactSompiAsKas(allTime?.sompi ?? 0n),
    totalKasReceivedDelta7d: compactSompiAsKas(last7d?.sompi ?? 0n),
    totalKasReceivedExact: formatSompiAsKas(allTime?.sompi ?? null),
    totalLinks,
    totalLinksDelta7d,
  };
}

const getCachedStats = unstable_cache(loadStats, ["public-stats-page"], { revalidate: 60 });

export default async function StatsPage() {
  const stats = await getCachedStats();
  const totalsByType = stats.linkTypeBreakdown.reduce((acc, row) => acc + row.count, 0);
  const orderedTypes = [...stats.linkTypeBreakdown].sort((a, b) => b.count - a.count);

  return (
    <main className="main-wide">
      <section className="card card-accent">
        <span className="label">Public stats</span>
        <h1 style={{ marginBottom: 6 }}>Live numbers from Kaspa Links</h1>
        <p className="muted" style={{ margin: 0 }}>
          Aggregate counts across every link, every creator, and every confirmed on-chain payment.
          Refreshes every minute. Individual creator identities are never exposed.
        </p>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span className="metric-label">Links created</span>
          <p className="metric-value">{stats.totalLinks}</p>
          <p className="metric-delta">
            {stats.totalLinksDelta7d > 0 ? (
              <>
                +{stats.totalLinksDelta7d} <span>last 7d</span>
              </>
            ) : (
              <span>—</span>
            )}
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Confirmed payments</span>
          <p className="metric-value">{stats.confirmedPayments}</p>
          <p className="metric-delta">
            {stats.confirmedPaymentsDelta7d > 0 ? (
              <>
                +{stats.confirmedPaymentsDelta7d} <span>last 7d</span>
              </>
            ) : (
              <span>—</span>
            )}
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">KAS received</span>
          <p className="metric-value" title={`${stats.totalKasReceivedExact} KAS`}>
            {stats.totalKasReceived} <span className="metric-value-unit">KAS</span>
          </p>
          <p className="metric-delta">
            {stats.totalKasReceivedDelta7d !== "0" ? (
              <>
                +{stats.totalKasReceivedDelta7d} <span>KAS · last 7d</span>
              </>
            ) : (
              <span>—</span>
            )}
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Active creators</span>
          <p className="metric-value">{stats.activeCreators}</p>
          <p className="metric-delta">
            {stats.activeCreatorsDelta7d > 0 ? (
              <>
                +{stats.activeCreatorsDelta7d} <span>active · last 7d</span>
              </>
            ) : (
              <span>—</span>
            )}
          </p>
        </article>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Link types · confirmed payments by category</h2>
        {totalsByType === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No confirmed payments yet — be the first.
          </p>
        ) : (
          <div className="distribution-list">
            {orderedTypes.map((row) => {
              const pct = totalsByType === 0 ? 0 : Math.round((row.count / totalsByType) * 100);
              return (
                <div className="distribution-row" key={row.type}>
                  <span className="distribution-label">{humanType(row.type)}</span>
                  <div className="distribution-bar" aria-hidden="true">
                    <div className="distribution-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="distribution-value">
                    {row.count} <span className="muted">· {pct}%</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Recent confirmations</h2>
        {stats.recentConfirmations.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No confirmed payments yet. Recent on-chain receipts will appear here.
          </p>
        ) : (
          <ul className="activity-list">
            {stats.recentConfirmations.map((row, idx) => {
              const explorer = kaspaStreamUrl(row.txId);
              return (
                <li className="activity-row" key={`${row.txId ?? "no-tx"}-${idx}`}>
                  <div className="activity-amount">
                    <strong>{row.amountKas ?? "—"}</strong>
                    <span>KAS</span>
                  </div>
                  <div className="activity-meta">
                    <span className="activity-title">{humanType(row.type)}</span>
                    <span className="activity-time">{relativeTime(row.confirmedAt)}</span>
                  </div>
                  <div className="activity-tx">
                    {explorer ? (
                      <a href={explorer} rel="noreferrer" target="_blank">
                        {compactTxId(row.txId)}
                      </a>
                    ) : (
                      <span className="value-mono">{compactTxId(row.txId)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
