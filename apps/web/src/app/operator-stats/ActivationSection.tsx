import type { ActivationFunnel, FunnelSourceKey } from "@/lib/activation-funnel";
import { HEADLINE_DAYS } from "@/lib/activation-funnel";
import { SIGNUP_SOURCE_LABELS } from "@/lib/signup-source";

import { MetricCard } from "./MetricCard";

const numberFormat = new Intl.NumberFormat("en-US");
const weekFormat = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function formatRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function sourceLabel(key: FunnelSourceKey): string {
  return key === "other" ? "Other / direct" : SIGNUP_SOURCE_LABELS[key];
}

/**
 * Activated Creators (docs/adr/0006) and where they came from. Counts come first,
 * rates second, because the numbers are small.
 */
export function ActivationSection({ funnel }: { funnel: ActivationFunnel | null }) {
  if (!funnel) {
    return (
      <section className="card">
        <span className="label">Activation</span>
        <h2>Activated creators</h2>
        <p className="muted operator-empty">Activation data unavailable.</p>
      </section>
    );
  }

  const { headline } = funnel;
  const decided = headline.signups - headline.pending;
  const totals = funnel.bySource.reduce(
    (sum, row) => ({
      activated: sum.activated + row.activated,
      clicks: sum.clicks + row.clicks,
      pending: sum.pending + row.pending,
      signups: sum.signups + row.signups,
    }),
    { activated: 0, clicks: 0, pending: 0, signups: 0 },
  );

  return (
    <section className="card">
      <div className="section-heading-row">
        <div>
          <span className="label">Activation · last {HEADLINE_DAYS} days</span>
          <h2>Activated creators</h2>
        </div>
        <span className="operator-chip">
          {numberFormat.format(funnel.internalExcluded)} internal excluded
        </span>
      </div>

      <div className="metric-grid">
        <MetricCard
          detail={`of ${numberFormat.format(decided)} decided · ${numberFormat.format(headline.pending)} pending`}
          label="Activated creators"
          value={numberFormat.format(headline.activated)}
        />
        <MetricCard
          detail={`${numberFormat.format(headline.promptSignups)} via growth prompts`}
          label="New creators"
          value={numberFormat.format(headline.newCreators)}
        />
        <MetricCard
          detail="Daily visitors from prompts"
          label="Prompt clicks"
          value={numberFormat.format(headline.promptClicks)}
        />
        <MetricCard
          detail="From pay-share links"
          label="Shared-page visits"
          value={numberFormat.format(headline.payShareVisits)}
        />
      </div>

      <div className="operator-stack">
        <article className="card card-muted">
          <span className="label">Growth prompts</span>
          <h3>Clicks → signups → activated</h3>
          <div className="operator-table-wrap">
            <table className="operator-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Clicks</th>
                  <th scope="col">Signups</th>
                  <th scope="col">Activated</th>
                  <th scope="col">Pending</th>
                  <th scope="col">Click → signup</th>
                </tr>
              </thead>
              <tbody>
                {funnel.bySource.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{sourceLabel(row.key)}</th>
                    <td>{row.key === "other" ? "—" : numberFormat.format(row.clicks)}</td>
                    <td>{numberFormat.format(row.signups)}</td>
                    <td>{numberFormat.format(row.activated)}</td>
                    <td>{numberFormat.format(row.pending)}</td>
                    <td>{row.key === "other" ? "—" : formatRate(row.signups, row.clicks)}</td>
                  </tr>
                ))}
                <tr className="operator-table-total">
                  <th scope="row">Total</th>
                  <td>{numberFormat.format(totals.clicks)}</td>
                  <td>{numberFormat.format(totals.signups)}</td>
                  <td>{numberFormat.format(totals.activated)}</td>
                  <td>{numberFormat.format(totals.pending)}</td>
                  <td>—</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="card card-muted">
          <span className="label">Signup cohorts</span>
          <h3>Weeks start Monday (UTC)</h3>
          <div className="operator-table-wrap">
            <table className="operator-table">
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col">Signups</th>
                  <th scope="col">Via prompt</th>
                  <th scope="col">Activated</th>
                  <th scope="col">Pending</th>
                  <th scope="col">Rate</th>
                </tr>
              </thead>
              <tbody>
                {funnel.cohorts.map((row) => (
                  <tr
                    className={row.complete ? undefined : "operator-table-row-open"}
                    key={row.weekStart}
                  >
                    <th scope="row">
                      {weekFormat.format(new Date(row.weekStart))}
                      {row.complete ? null : " · open"}
                    </th>
                    <td>{numberFormat.format(row.signups)}</td>
                    <td>{numberFormat.format(row.viaPrompt)}</td>
                    <td>{numberFormat.format(row.activated)}</td>
                    <td>{numberFormat.format(row.pending)}</td>
                    <td>{row.rate === null ? "—" : `${Math.round(row.rate * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <p className="muted operator-footnote">
        Activated: first confirmed mainnet payment or claimed claimable link within 7 days of
        signup. Clicks: distinct daily visitors reaching profile creation from a growth prompt.
        Pending creators are still inside their 7 days and stay out of the rate.
      </p>
    </section>
  );
}
