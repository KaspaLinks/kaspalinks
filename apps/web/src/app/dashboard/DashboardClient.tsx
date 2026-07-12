"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SESSION_EVENT } from "../BrandNav";
import {
  buildRecentActivity,
  calculateDashboardAnalyticsRollup,
  calculateDashboardMetrics,
  compactKas,
  compactSompiAsKas,
  formatSompiAsKas,
  type ActionPaymentBundle,
  type AddressPayment,
  type CreatorAction,
  type CreatorLinkAnalytics,
} from "./metrics";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";
const RECENT_LIMIT = 6;

type Creator = {
  displayName: null | string;
  username: string;
};

type CreatorActionPaymentStates = Record<
  string,
  {
    error: null | string;
    payments: AddressPayment[];
  }
>;

type RecentSupporterMessage = {
  actionPublicId: string;
  actionTitle: string;
  amountKas: null | string;
  confirmedAt: null | string;
  message: string;
  network: "mainnet" | "testnet";
  sharePath: string;
  txId: null | string;
};

type SupporterWallEntry = {
  actionPublicId: string;
  actionTitle: string;
  amountKas: null | string;
  confirmedAt: null | string;
  hidden: boolean;
  id: string;
  message: null | string;
  network: "mainnet" | "testnet";
  sharePath: string;
  supporterName: null | string;
  txId: null | string;
};

type ClaimableDashboardLink = {
  amountSompi: string;
  feeSompi: string;
  id: string;
  linkKey: string;
  status: string;
  title: string;
};

type ClaimableDashboardStats = {
  claimed: number;
  claimedNetSompi: bigint;
  funded: number;
  lockedSompi: bigint;
  refunded: number;
  total: number;
};

function readSessionValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function compactTxId(txId: string): string {
  if (txId.length <= 18) return txId;
  return `${txId.slice(0, 10)}...${txId.slice(-6)}`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function humanActionType(type: string): string {
  switch (type) {
    case "kaspa.tip":
      return "Tip";
    case "kaspa.donation":
      return "Donation";
    case "kaspa.invoice":
      return "Invoice";
    case "kaspa.transfer":
      return "Transfer";
    case "kaspa.goal":
      return "Goal";
    default:
      return type;
  }
}

function formatCount(count: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(count);
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function kaspaStreamTransactionUrl(txId: string, network: CreatorAction["network"]): null | string {
  if (network !== "mainnet" || !/^[0-9a-f]+$/i.test(txId)) return null;
  return `https://kaspa.stream/transactions/${encodeURIComponent(txId)}`;
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function calculateClaimableDashboardStats(
  links: ClaimableDashboardLink[],
): ClaimableDashboardStats {
  let claimed = 0;
  let claimedNetSompi = 0n;
  let funded = 0;
  let lockedSompi = 0n;
  let refunded = 0;

  for (const link of links) {
    const amountSompi = safeBigInt(link.amountSompi);
    const feeSompi = safeBigInt(link.feeSompi);

    if (link.status === "claimed") {
      claimed += 1;
      claimedNetSompi += amountSompi > feeSompi ? amountSompi - feeSompi : amountSompi;
    } else if (link.status === "refunded") {
      refunded += 1;
    } else if (link.status === "funded" || link.status === "shared" || link.status === "refundable") {
      funded += 1;
      lockedSompi += amountSompi;
    }
  }

  return {
    claimed,
    claimedNetSompi,
    funded,
    lockedSompi,
    refunded,
    total: links.length,
  };
}

export function DashboardClient() {
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [creator, setCreator] = useState<Creator | null>(null);
  const [bundles, setBundles] = useState<ActionPaymentBundle[]>([]);
  const [linkAnalytics, setLinkAnalytics] = useState<Record<string, CreatorLinkAnalytics>>({});
  const [analyticsError, setAnalyticsError] = useState<null | string>(null);
  const [analyticsWindowDays, setAnalyticsWindowDays] = useState(90);
  const [supporterMessages, setSupporterMessages] = useState<RecentSupporterMessage[]>([]);
  const [supporterWallEntries, setSupporterWallEntries] = useState<SupporterWallEntry[]>([]);
  const [claimableLinks, setClaimableLinks] = useState<ClaimableDashboardLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);

  const signedIn = username.length > 0 && token.length > 0;

  // Hydrate session + listen for sign-out across tabs / brand-bar.
  useEffect(() => {
    setUsername(readSessionValue(USERNAME_STORAGE_KEY));
    setToken(readSessionValue(TOKEN_STORAGE_KEY));
    setHydrated(true);

    function refresh() {
      setUsername(readSessionValue(USERNAME_STORAGE_KEY));
      setToken(readSessionValue(TOKEN_STORAGE_KEY));
    }

    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!username || !token) return;
    setLoading(true);
    setError(null);
    setAnalyticsError(null);

    const headers = {
      "x-creator-token": token,
      "x-creator-username": username,
    };

    try {
      const actionsRes = await fetch("/api/creator/actions", { headers });
      const actionsBody = await actionsRes.json();
      if (!actionsRes.ok) {
        setError(actionsBody?.error?.message ?? "Could not load your account.");
        setLoading(false);
        return;
      }

      setCreator(actionsBody.creator);
      const actions: CreatorAction[] = actionsBody.actions ?? [];

      const paymentRes = await fetch("/api/creator/action-payments", { headers });
      const paymentBody = await paymentRes.json();
      const paymentStates: CreatorActionPaymentStates =
        paymentRes.ok && paymentBody?.paymentStates ? paymentBody.paymentStates : {};
      setSupporterMessages(
        paymentRes.ok && Array.isArray(paymentBody?.recentSupporterMessages)
          ? paymentBody.recentSupporterMessages
          : [],
      );
      setSupporterWallEntries(
        paymentRes.ok && Array.isArray(paymentBody?.supporterWallEntries)
          ? paymentBody.supporterWallEntries
          : [],
      );

      setBundles(
        actions.map((action) => ({
          action,
          payments: paymentStates[action.publicId]?.payments ?? [],
        })),
      );

      try {
        const claimableRes = await fetch("/api/creator/claimable-links", { headers });
        const claimableBody = await claimableRes.json();
        setClaimableLinks(
          claimableRes.ok && Array.isArray(claimableBody?.claimableLinks)
            ? claimableBody.claimableLinks
            : [],
        );
      } catch {
        setClaimableLinks([]);
      }

      try {
        const analyticsRes = await fetch("/api/creator/action-analytics", { headers });
        const analyticsBody = await analyticsRes.json();
        if (analyticsRes.ok) {
          setLinkAnalytics(analyticsBody.analytics ?? {});
          setAnalyticsWindowDays(
            Number.isFinite(Number(analyticsBody?.source?.windowDays))
              ? Number(analyticsBody.source.windowDays)
              : 90,
          );
        } else {
          setLinkAnalytics({});
          setAnalyticsError(analyticsBody?.error?.message ?? "Could not load link analytics.");
        }
      } catch {
        setLinkAnalytics({});
        setAnalyticsError("Could not load link analytics.");
      }
    } catch {
      setError("Network error while loading dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [token, username]);

  useEffect(() => {
    if (hydrated && signedIn) {
      void loadData();
    }
  }, [hydrated, loadData, signedIn]);

  const metrics = useMemo(() => calculateDashboardMetrics(bundles), [bundles]);
  const analyticsRollup = useMemo(
    () =>
      calculateDashboardAnalyticsRollup(
        bundles.map((bundle) => bundle.action),
        linkAnalytics,
        analyticsWindowDays,
      ),
    [analyticsWindowDays, bundles, linkAnalytics],
  );
  const claimableStats = useMemo(
    () => calculateClaimableDashboardStats(claimableLinks),
    [claimableLinks],
  );

  const recentActivity = useMemo(() => buildRecentActivity(bundles, RECENT_LIMIT), [bundles]);
  const hasPaymentLinks = bundles.length > 0;
  const hasClaimableLinks = claimableStats.total > 0;

  const setSupporterWallHidden = useCallback(
    async (entryId: string, hidden: boolean) => {
      if (!username || !token) return;
      setError(null);

      try {
        const response = await fetch(`/api/creator/supporter-wall/${encodeURIComponent(entryId)}`, {
          body: JSON.stringify({ hidden }),
          headers: {
            "content-type": "application/json",
            "x-creator-token": token,
            "x-creator-username": username,
          },
          method: "PATCH",
        });
        const body = await response.json();
        if (!response.ok) {
          setError(body?.error?.message ?? "Could not update supporter wall entry.");
          return;
        }
        // Keep the entry in the list and just flip its flag, so a hidden entry
        // stays visible to the creator (muted) with a "Show" action.
        setSupporterWallEntries((current) =>
          current.map((entry) => (entry.id === entryId ? { ...entry, hidden } : entry)),
        );
      } catch {
        setError("Network error while updating supporter wall entry.");
      }
    },
    [token, username],
  );

  // All three render branches use `main.main-wide` so the brand-bar's
  // `body:has(main.main-wide)` rule keeps it at the desktop width across
  // hydration. Without this, the first paint (before useEffect runs)
  // returns a plain `<main>`, the :has() selector flips false, the
  // brand-bar shrinks from 1100px → 640px, then snaps back one frame
  // later when the signed-in branch returns. Visually that looked like
  // a second logo flashing next to the real one on /my-links → /dashboard
  // hops — same logo, two different positions, one frame apart.
  if (!hydrated) {
    return (
      <main className="main-wide">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading...
          </p>
        </section>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="main-wide">
        <section className="card card-accent">
          <span className="label">Creator dashboard</span>
          <h1 style={{ marginBottom: 6 }}>Sign in to your dashboard</h1>
          <p className="muted" style={{ marginBottom: 14 }}>
            See your KAS received at a glance, watch recent receipts, and jump into your links.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href="/sign-in">
              Sign in
            </Link>
            <Link className="btn" href="/create-profile">
              Create profile
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="main-wide">
      <section className="card card-accent">
        <span className="label">Welcome back</span>
        <h1 style={{ marginBottom: 6 }}>{creator?.displayName ?? creator?.username ?? username}</h1>
        <p className="muted" style={{ margin: 0 }}>
          Public namespace: <code>/u/{creator?.username ?? username}</code>
        </p>
        <div className="row" style={{ marginTop: 14 }}>
          <Link className="btn btn-primary" href="/new-link">
            Create a new link
          </Link>
          <Link className="btn" href="/my-links">
            Manage links
          </Link>
          <Link className="btn" href="/my-profile">
            My profile
          </Link>
          <button className="btn" disabled={loading} onClick={() => void loadData()} type="button">
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {error ? <p className="error-text">{error}</p> : null}

      <section className="metric-grid">
        <article className="metric-card">
          <span className="metric-label">Total received</span>
          <p className="metric-value" title={`${formatSompiAsKas(metrics.totalSompi)} KAS`}>
            {compactSompiAsKas(metrics.totalSompi)} <span className="metric-value-unit">KAS</span>
          </p>
          <p className="metric-delta">
            {metrics.totalSompi === 0n ? (
              <span>Nothing yet</span>
            ) : metrics.weeklySompi === metrics.totalSompi ? (
              <span>All in last 7d</span>
            ) : metrics.weeklySompi === 0n ? (
              <span>Nothing new last 7d</span>
            ) : (
              <>
                +{compactSompiAsKas(metrics.weeklySompi)} <span>KAS · last 7d</span>
              </>
            )}
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Payments</span>
          <p className="metric-value">{metrics.totalPayments}</p>
          <p className="metric-delta">
            {metrics.totalPayments === 0 ? (
              <span>Nothing yet</span>
            ) : metrics.weeklyPayments === metrics.totalPayments ? (
              <span>All in last 7d</span>
            ) : metrics.weeklyPayments === 0 ? (
              <span>Nothing new last 7d</span>
            ) : (
              <>
                +{metrics.weeklyPayments} <span>last 7d</span>
              </>
            )}
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Active links</span>
          <p className="metric-value">{metrics.activeLinks}</p>
          <p className="metric-delta">
            of <span>{metrics.totalLinks} total</span>
          </p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Average</span>
          <p
            className="metric-value"
            title={
              metrics.totalPayments > 0
                ? `${formatSompiAsKas(metrics.totalSompi / BigInt(metrics.totalPayments))} KAS`
                : undefined
            }
          >
            {metrics.totalPayments > 0
              ? compactSompiAsKas(metrics.totalSompi / BigInt(metrics.totalPayments))
              : "0"}{" "}
            <span className="metric-value-unit">KAS</span>
          </p>
          <p className="metric-delta">
            <span>per payment</span>
          </p>
        </article>
      </section>

      <section className="card dashboard-rollup-card">
        <div className="row row-between" style={{ marginBottom: 10 }}>
          <div>
            <span className="label">Link performance</span>
            <h2 style={{ margin: "4px 0 0" }}>Creator analytics</h2>
          </div>
          <span className="muted">
            {hasPaymentLinks ? `Last ${analyticsRollup.windowDays}d` : "Claimable status"}
          </span>
        </div>
        {!hasPaymentLinks && !hasClaimableLinks ? (
          <p className="muted" style={{ margin: 0 }}>
            Create your first link to start seeing views, pay starts, and confirmations here.
          </p>
        ) : (
          <>
            {analyticsError && hasPaymentLinks ? (
              <p className="error-text" style={{ margin: 0 }}>
                {analyticsError}
              </p>
            ) : null}
            {hasPaymentLinks && !analyticsError ? (
              <>
                <div className="dashboard-rollup-grid">
                  <div>
                    <span className="metric-label">Views</span>
                    <strong>{formatCount(analyticsRollup.totalViews)}</strong>
                    <small>human page views</small>
                  </div>
                  <div>
                    <span className="metric-label">Pay starts</span>
                    <strong>{formatCount(analyticsRollup.totalPayStarts)}</strong>
                    <small>{formatRate(analyticsRollup.requestFromViewRate)} from views</small>
                  </div>
                  <div>
                    <span className="metric-label">Confirmed</span>
                    <strong>{formatCount(analyticsRollup.totalConfirmed)}</strong>
                    <small>{formatRate(analyticsRollup.confirmedFromViewRate)} from views</small>
                  </div>
                </div>
                <div className="dashboard-rollup-insights">
                  <div>
                    <span className="metric-label">Best link</span>
                    {analyticsRollup.bestLink ? (
                      <>
                        <Link
                          className="dashboard-rollup-link"
                          href={analyticsRollup.bestLink.action.sharePath}
                        >
                          {analyticsRollup.bestLink.action.title}
                        </Link>
                        <p className="muted" style={{ margin: 0 }}>
                          {formatCount(
                            analyticsRollup.bestLink.analytics.confirmedPayments.total,
                          )}{" "}
                          confirmed ·{" "}
                          {formatCount(analyticsRollup.bestLink.analytics.views.total)} views
                        </p>
                      </>
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        No viewed payment links yet.
                      </p>
                    )}
                  </div>
                </div>
              </>
            ) : null}
            {hasClaimableLinks ? (
              <>
                <div className="dashboard-rollup-grid dashboard-claimable-grid">
                  <div>
                    <span className="metric-label">Claimable links</span>
                    <strong>{formatCount(claimableStats.total)}</strong>
                    <small>created rewards</small>
                  </div>
                  <div>
                    <span className="metric-label">Funded / ready</span>
                    <strong>{formatCount(claimableStats.funded)}</strong>
                    <small>{compactSompiAsKas(claimableStats.lockedSompi)} KAS locked</small>
                  </div>
                  <div>
                    <span className="metric-label">Claimed</span>
                    <strong>{formatCount(claimableStats.claimed)}</strong>
                    <small>{compactSompiAsKas(claimableStats.claimedNetSompi)} KAS sent</small>
                  </div>
                  <div>
                    <span className="metric-label">Refunded</span>
                    <strong>{formatCount(claimableStats.refunded)}</strong>
                    <small>returned by creator refund</small>
                  </div>
                </div>
                <p className="muted dashboard-rollup-note">
                  Claimable links use private URL fragments, so the normal views → pay starts funnel
                  is tracked only for payment links. Claimables show funding, claim, and refund
                  status instead.
                </p>
              </>
            ) : null}
          </>
        )}
      </section>

      <section className="card">
        <div className="row row-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Recent activity</h2>
          <Link className="brand-link" href="/my-links">
            View all →
          </Link>
        </div>
        {recentActivity.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {bundles.length === 0
              ? "Create your first link to start receiving on-chain payments."
              : loading
                ? "Loading recent receipts..."
                : "No on-chain payments seen yet. The indexer scans the latest 25 receipts per recipient address."}
          </p>
        ) : (
          <ul className="activity-list">
            {recentActivity.map((item) => {
              const explorerUrl = item.payment.transactionId
                ? kaspaStreamTransactionUrl(item.payment.transactionId, item.action.network)
                : null;
              return (
                <li
                  className="activity-row"
                  key={`${item.action.publicId}:${item.payment.transactionId}:${item.payment.outputIndex}`}
                >
                  <div className="activity-amount" title={`${item.payment.amountKas} KAS`}>
                    <strong>{compactKas(item.payment.amountKas)}</strong>
                    <span>KAS</span>
                  </div>
                  <div className="activity-meta">
                    <Link className="activity-title" href={item.action.sharePath}>
                      {item.action.title}
                    </Link>
                    <span className="activity-time">
                      {humanActionType(item.action.type)} ·{" "}
                      {item.payment.blockTime ? relativeTime(item.payment.blockTime) : "—"}
                    </span>
                  </div>
                  <div className="activity-tx">
                    {explorerUrl ? (
                      <a href={explorerUrl} rel="noreferrer" target="_blank">
                        {compactTxId(item.payment.transactionId)}
                      </a>
                    ) : (
                      <span className="value-mono">{compactTxId(item.payment.transactionId)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row row-between" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Public supporter wall</h2>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              Opt-in supporter entries shown on your public profile. Wallet addresses stay hidden.
            </p>
          </div>
          <Link className="brand-link" href="/my-profile">
            Manage profile →
          </Link>
        </div>
        {supporterWallEntries.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No public supporter wall entries yet. Supporters can opt in during payment.
          </p>
        ) : (
          <ul className="dashboard-wall-list">
            {supporterWallEntries.map((item) => {
              const explorerUrl = item.txId
                ? kaspaStreamTransactionUrl(item.txId, item.network)
                : null;
              return (
                <li
                  className={`dashboard-wall-row${item.hidden ? " dashboard-wall-row--hidden" : ""}`}
                  key={item.id}
                >
                  <div className="dashboard-wall-row-main">
                    <div className="dashboard-wall-row-heading">
                      <strong>{item.supporterName ?? "Anonymous"}</strong>
                      {item.hidden ? (
                        <span className="dashboard-wall-hidden-tag">Hidden</span>
                      ) : null}
                      <span
                        className="muted"
                        title={item.amountKas ? `${item.amountKas} KAS` : undefined}
                      >
                        {item.amountKas ? `${compactKas(item.amountKas)} KAS · ` : ""}
                        {item.confirmedAt
                          ? relativeTime(new Date(item.confirmedAt).getTime())
                          : "—"}
                      </span>
                    </div>
                    {item.message ? <p>&ldquo;{item.message}&rdquo;</p> : null}
                    <p className="supporter-note-tx">
                      <Link href={item.sharePath}>{item.actionTitle}</Link>
                      {item.txId ? (
                        <>
                          {" · "}
                          {explorerUrl ? (
                            <a href={explorerUrl} rel="noreferrer" target="_blank">
                              {compactTxId(item.txId)}
                            </a>
                          ) : (
                            <span className="value-mono">{compactTxId(item.txId)}</span>
                          )}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <button
                    className="btn btn-sm"
                    onClick={() => void setSupporterWallHidden(item.id, !item.hidden)}
                    type="button"
                  >
                    {item.hidden ? "Show" : "Hide"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="row row-between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Recent supporter notes</h2>
          <span className="muted">Off-chain only</span>
        </div>
        {supporterMessages.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No supporter notes yet. They appear here after a confirmed payment includes one.
          </p>
        ) : (
          <ul className="supporter-note-list">
            {supporterMessages.map((item) => {
              const explorerUrl = item.txId
                ? kaspaStreamTransactionUrl(item.txId, item.network)
                : null;
              return (
                <li
                  className="supporter-note-row"
                  key={`${item.actionPublicId}:${item.confirmedAt}:${item.message}`}
                >
                  <div className="supporter-note-meta">
                    <Link href={item.sharePath}>{item.actionTitle}</Link>
                    <span
                      className="muted"
                      title={item.amountKas ? `${item.amountKas} KAS` : undefined}
                    >
                      {item.amountKas ? `${compactKas(item.amountKas)} KAS · ` : ""}
                      {item.confirmedAt ? relativeTime(new Date(item.confirmedAt).getTime()) : "—"}
                    </span>
                  </div>
                  <p>&ldquo;{item.message}&rdquo;</p>
                  {item.txId ? (
                    <p className="supporter-note-tx">
                      <span className="muted">Transaction:</span>{" "}
                      {explorerUrl ? (
                        <a href={explorerUrl} rel="noreferrer" target="_blank">
                          {compactTxId(item.txId)}
                        </a>
                      ) : (
                        <span className="value-mono">{compactTxId(item.txId)}</span>
                      )}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
