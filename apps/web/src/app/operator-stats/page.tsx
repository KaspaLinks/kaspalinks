import type { Metadata } from "next";
import { prisma } from "@kaspa-actions/db";

import { loadActivationFunnel } from "@/lib/activation-funnel";
import { resolveClaimableOnChain } from "@/lib/claimable-onchain";
import type { RankedMetric } from "@/lib/operator-stats";
import { loadPersistentOperatorStatsFromAccessLogs } from "@/lib/operator-stats";
import { loadTelegramBotStats, type TelegramBotStats } from "@/lib/telegram-bot-stats";

import { ActivationSection } from "./ActivationSection";
import { MetricCard } from "./MetricCard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operator Stats · Kaspa Links",
};

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function formatDateTime(value: null | string): string {
  if (!value) return "No visits yet";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatTrackingWindow(earliest: null | string, latest: null | string): string {
  if (!earliest || !latest) return "No tracked visits yet";

  const earliestDate = new Date(earliest);
  const latestDate = new Date(latest);
  const diffMs = Math.max(0, latestDate.getTime() - earliestDate.getTime());
  const diffHours = diffMs / (60 * 60 * 1000);

  if (diffHours < 1) return "Less than 1h of logs available";
  if (diffHours < 48) return `${Math.floor(diffHours)}h of logs available`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d of logs available`;
}

function formatSourceDetail({
  earliestSeenAt,
  filesRead,
  linesParsed,
  storage,
}: {
  earliestSeenAt: null | string;
  filesRead: number;
  linesParsed: number;
  storage: "database" | "logs";
}): string {
  const unit = storage === "database" ? "stored views" : "readable log entries";
  const logSummary = `${formatNumber(linesParsed)} ${unit} · ${filesRead} log files scanned`;
  if (!earliestSeenAt) return logSummary;
  return `Since ${formatDateTime(earliestSeenAt)} · ${logSummary}`;
}

function formatTrackedTotalDetail(earliest: null | string, botHits: number): string {
  const botSummary = `${formatNumber(botHits)} bot or preview hits`;
  if (!earliest) return botSummary;

  const start = new Date(earliest).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `Since ${start} · ${botSummary}`;
}

function sompiToKas(sompi: bigint): string {
  const whole = sompi / 100000000n;
  const frac = (sompi % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

// Labels are fixed by telegramUpdateLabel; this only makes them readable.
const TELEGRAM_LABELS: Record<string, string> = {
  "/other": "Other command",
  "button:draft": "Button: giveaway setup",
  "button:menu": "Button: menu",
  "button:notify": "Button: alerts on/off",
  "button:other": "Button: other",
  "button:watch": "Button: result reminder",
  text: "Free text",
};

const TELEGRAM_MESSAGE_KINDS: Record<string, string> = {
  "claimable.status": "Claim link claimed / returned",
  "giveaway.result": "Giveaway result",
  "payment.confirmed": "Payment received",
};

function TelegramBotSection({ stats }: { stats: TelegramBotStats }) {
  return (
    <section className="card">
      <div className="section-heading-row">
        <div>
          <span className="label">Telegram bot</span>
          <h2>Bot usage</h2>
          <p className="muted" style={{ margin: 0 }}>
            Counted from chats, update timestamps with a fixed label and Mini App page views.
            {stats.interactions.since
              ? ` Interactions since ${formatDateTime(stats.interactions.since.toISOString())}.`
              : ""}
          </p>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard
          detail={`${formatNumber(stats.chats.withoutAccount)} without account · ${formatNumber(stats.chats.withAccount)} with · +${formatNumber(stats.chats.new7d)} in 7d`}
          label="Chats"
          value={formatNumber(stats.chats.total)}
        />
        <MetricCard
          detail={`${formatNumber(stats.activeChats.last24h)} in 24h · ${formatNumber(stats.activeChats.last30d)} in 30d`}
          label="Active chats 7d"
          value={formatNumber(stats.activeChats.last7d)}
        />
        <MetricCard
          detail={`${formatNumber(stats.interactions.last24h)} in 24h · ${formatNumber(stats.interactions.last30d)} in 30d · ${formatNumber(stats.interactions.total)} total`}
          label="Commands & taps 7d"
          value={formatNumber(stats.interactions.last7d)}
        />
        <MetricCard
          detail={`${formatNumber(stats.miniAppViews.last30d)} in 30d`}
          label="Mini App opens 7d"
          value={formatNumber(stats.miniAppViews.last7d)}
        />
        <MetricCard
          detail={`+${formatNumber(stats.created.paymentLinks7d)} in 7d`}
          label="Payment links via bot"
          value={formatNumber(stats.created.paymentLinks)}
        />
        <MetricCard
          detail={`+${formatNumber(stats.created.claimLinks7d)} in 7d`}
          label="Claim links via bot"
          value={formatNumber(stats.created.claimLinks)}
        />
        <MetricCard
          detail={`${formatNumber(stats.messagesSent.last7d)} in 7d`}
          label="Messages sent"
          value={formatNumber(stats.messagesSent.total)}
        />
        <MetricCard
          detail="Chats that blocked the bot"
          label="Blocked"
          value={formatNumber(stats.chats.blocked)}
        />
      </div>
      <div className="operator-grid">
        <article>
          <span className="label">Last 30 days</span>
          <h3>Commands and buttons</h3>
          <RankedList
            empty="No labelled bot updates yet. Counting starts with this release."
            rows={stats.topActions30d.map((row) => ({
              count: row.count,
              label: TELEGRAM_LABELS[row.label] ?? row.label,
            }))}
          />
        </article>
        <article>
          <span className="label">All time</span>
          <h3>Messages the bot sent</h3>
          <RankedList
            empty="The bot has not sent any notifications yet."
            rows={stats.messagesSent.byKind.map((row) => ({
              count: row.count,
              label: TELEGRAM_MESSAGE_KINDS[row.kind] ?? row.kind,
            }))}
          />
        </article>
      </div>
    </section>
  );
}

function RankedList({ empty, rows }: { empty: string; rows: RankedMetric[] }) {
  if (rows.length === 0) {
    return <p className="muted operator-empty">{empty}</p>;
  }

  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="operator-ranked-list">
      {rows.map((row) => {
        const width = Math.max(8, Math.round((row.count / max) * 100));
        return (
          <div className="operator-ranked-row" key={row.label}>
            <div className="operator-ranked-meta">
              <span>{row.label}</span>
              <strong>{formatNumber(row.count)}</strong>
            </div>
            <div className="operator-ranked-bar" aria-hidden="true">
              <span style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const CLAIMABLE_REFRESH_STATUSES = ["awaiting_funding", "funded", "shared", "refundable"];

async function refreshClaimableStatsSnapshot() {
  const candidates = await prisma.claimableLink.findMany({
    orderBy: { updatedAt: "asc" },
    take: 25,
    where: {
      deletedAt: null,
      status: {
        in: CLAIMABLE_REFRESH_STATUSES,
      },
    },
  });

  await Promise.all(
    candidates.map(async (link) => {
      try {
        const update = await resolveClaimableOnChain({
          amountSompi: link.amountSompi.toString(),
          claimTxId: link.claimTxId,
          createdAtMs: link.createdAt.getTime(),
          fundingAddress: link.fundingAddress,
          fundingOutputIndex: link.fundingOutputIndex,
          fundingTxId: link.fundingTxId,
          refundLockTime: link.refundLockTime,
          refundTxId: link.refundTxId,
          status: link.status,
        });
        if (!update) return;
        await prisma.claimableLink.update({
          data: {
            fundingOutputIndex: update.fundingOutputIndex,
            fundingTxId: update.fundingTxId,
            status: update.status,
          },
          where: { id: link.id },
        });
      } catch {
        // Operator stats should stay available even if the public indexer hiccups.
      }
    }),
  );
}

export default async function OperatorStatsPage() {
  const stats = await loadPersistentOperatorStatsFromAccessLogs(prisma);
  // Runs after the log import so today's prompt clicks are already stored.
  const activation = await loadActivationFunnel(prisma).catch((error: unknown) => {
    console.error("Activation funnel unavailable", error);
    return null;
  });
  await refreshClaimableStatsSnapshot();
  const telegram = await loadTelegramBotStats(prisma).catch((error: unknown) => {
    console.error("Telegram bot stats unavailable", error);
    return null;
  });

  // Links the creator removed from My Links stay in the table for the audit
  // trail, but counting them here inflated every tile — most deleted links are
  // already refunded ones.
  const claimableGroups = await prisma.claimableLink.groupBy({
    _count: { _all: true },
    _sum: { amountSompi: true },
    by: ["status"],
    where: { deletedAt: null },
  });
  const claimableByStatus = new Map(claimableGroups.map((group) => [group.status, group]));
  const claimableCountFor = (status: string) => claimableByStatus.get(status)?._count._all ?? 0;
  const claimableSumFor = (status: string): bigint =>
    claimableByStatus.get(status)?._sum.amountSompi ?? 0n;
  const claimableTotal = claimableGroups.reduce((sum, group) => sum + group._count._all, 0);
  // "Locked" must mean capital actually parked on-chain. An awaiting_funding
  // link was never paid, so adding its intended amount overstated the figure
  // several times over; requiring a funding transaction keeps it honest.
  const claimableLocked = await prisma.claimableLink.aggregate({
    _sum: { amountSompi: true },
    where: {
      deletedAt: null,
      fundingTxId: { not: null },
      status: { in: ["funded", "shared", "refundable"] },
    },
  });
  const claimableLockedSompi = claimableLocked._sum.amountSompi ?? 0n;
  const claimableClaimedSompi = claimableSumFor("claimed");

  return (
    <main className="main-wide operator-stats-page">
      <section className="card card-accent operator-hero">
        <div>
          <span className="label">Private operator analytics</span>
          <h1>Website visits, without tracking scripts.</h1>
          <p className="muted">
            Built from Caddy access logs on this server and stored as deduplicated page-view
            aggregates. No cookies, no third-party analytics, no client-side tracking code.
          </p>
        </div>
        <div className="operator-source">
          <span>Latest visit</span>
          <strong>{formatDateTime(stats.source.latestSeenAt)}</strong>
          <small>
            {formatSourceDetail({
              earliestSeenAt: stats.source.earliestSeenAt,
              filesRead: stats.source.filesRead,
              linesParsed: stats.source.linesParsed,
              storage: stats.source.storage,
            })}
          </small>
        </div>
      </section>

      <section className="metric-grid">
        <MetricCard
          detail="Human page views"
          label="Last 24h"
          value={formatNumber(stats.pageViews.last24h)}
        />
        <MetricCard
          detail={formatTrackingWindow(stats.source.earliestSeenAt, stats.source.latestSeenAt)}
          label="Last 7d"
          value={formatNumber(stats.pageViews.last7d)}
        />
        <MetricCard
          detail="Daily IP + browser estimate"
          label="Unique visitors"
          value={formatNumber(stats.uniqueVisitors.approximate)}
        />
        <MetricCard
          detail={formatTrackedTotalDetail(stats.source.earliestSeenAt, stats.bots.hits)}
          label="Tracked page views"
          value={formatNumber(stats.pageViews.human)}
        />
      </section>

      <ActivationSection funnel={activation} />

      {telegram ? <TelegramBotSection stats={telegram} /> : null}

      <section className="card">
        <div className="section-heading-row">
          <div>
            <span className="label">Claimable links</span>
            <h2>Claimable link activity</h2>
          </div>
          <span className="operator-chip">{formatNumber(claimableTotal)} total</span>
        </div>
        <div className="metric-grid">
          <MetricCard
            detail="Created across all creators"
            label="Total links"
            value={formatNumber(claimableTotal)}
          />
          <MetricCard
            detail="In funded, unclaimed links"
            label="KAS locked"
            value={sompiToKas(claimableLockedSompi)}
          />
          <MetricCard
            detail={`${sompiToKas(claimableClaimedSompi)} KAS claimed`}
            label="Claimed"
            value={formatNumber(claimableCountFor("claimed"))}
          />
          <MetricCard
            detail="Returned to creators"
            label="Refunded"
            value={formatNumber(claimableCountFor("refunded"))}
          />
        </div>
        <RankedList
          empty="No claimable links created yet."
          rows={[
            { count: claimableCountFor("awaiting_funding"), label: "Awaiting funding" },
            {
              count: claimableCountFor("funded") + claimableCountFor("shared"),
              label: "Funded / shared",
            },
            { count: claimableCountFor("refundable"), label: "Refundable" },
            { count: claimableCountFor("claimed"), label: "Claimed" },
            { count: claimableCountFor("refunded"), label: "Refunded" },
          ].filter((row) => row.count > 0)}
        />
      </section>

      <section className="operator-grid operator-grid-map">
        <article className="card operator-map-card">
          <div className="section-heading-row">
            <div>
              <span className="label">Location overview</span>
              <h2>Visitor map</h2>
            </div>
            <span className="operator-chip">
              {formatNumber(stats.countryUnknownViews)} unknown country
            </span>
          </div>
          <div className="operator-map" aria-label="Approximate visitor countries">
            <div className="operator-map-plane" aria-hidden="true" />
            {stats.countries.map((country) => {
              const size = Math.min(34, 12 + Math.sqrt(country.count) * 5);
              return (
                <span
                  className="operator-map-dot"
                  key={country.code}
                  style={{
                    height: `${size}px`,
                    left: `${country.x}%`,
                    top: `${country.y}%`,
                    width: `${size}px`,
                  }}
                  title={`${country.name}: ${formatNumber(country.count)} visits`}
                >
                  <span>{country.code}</span>
                </span>
              );
            })}
            {stats.countries.length === 0 ? (
              <div className="operator-map-empty">
                Country dots appear when Caddy receives a country header from a proxy or GeoIP
                setup.
              </div>
            ) : null}
          </div>
        </article>

        <article className="card">
          <span className="label">Countries</span>
          <h2>Top countries</h2>
          <RankedList
            empty="No country headers seen yet."
            rows={stats.countries.map((country) => ({
              count: country.count,
              label: `${country.name} (${country.code})`,
            }))}
          />
        </article>
      </section>

      <section className="operator-grid">
        <article className="card">
          <span className="label">Traffic sources</span>
          <h2>Referrers</h2>
          <RankedList empty="No referrer data yet." rows={stats.referrers} />
        </article>

        <article className="card">
          <span className="label">Campaigns</span>
          <h2>UTM sources</h2>
          <RankedList empty="No utm_source parameters yet." rows={stats.utmSources} />
        </article>
      </section>

      <section className="operator-grid">
        <article className="card">
          <span className="label">Devices</span>
          <h2>Mobile vs desktop</h2>
          <RankedList empty="No device data yet." rows={stats.devices} />
        </article>

        <article className="card">
          <span className="label">Browsers</span>
          <h2>Browser mix</h2>
          <RankedList empty="No browser data yet." rows={stats.browsers} />
        </article>
      </section>

      <section className="operator-grid">
        <article className="card">
          <span className="label">Pages</span>
          <h2>Top pages</h2>
          <RankedList empty="No page views yet." rows={stats.pages} />
        </article>

        <article className="card">
          <span className="label">HTTP</span>
          <h2>Status codes</h2>
          <RankedList empty="No HTTP status data yet." rows={stats.statusCodes} />
        </article>
      </section>

      <section className="card card-muted operator-note">
        <h2>Privacy notes</h2>
        <p className="muted">
          This page reads rolling server logs, stores deduplicated page views, and shows aggregates
          only. It stores daily visitor hashes instead of raw IP addresses. Country data is
          best-effort; without a trusted proxy or GeoIP enrichment it will mostly show as unknown.
          Activation counts read creator signup dates, fixed prompt labels, and on-chain timestamps;
          internal accounts are excluded.
        </p>
        {stats.parseErrors > 0 ? (
          <p className="form-error">
            {formatNumber(stats.parseErrors)} log lines could not be parsed and were ignored.
          </p>
        ) : null}
      </section>
    </main>
  );
}
