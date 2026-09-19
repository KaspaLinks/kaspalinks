"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EscrowAmountBreakdown } from "../_components/EscrowAmountBreakdown";
import { PackageIcon } from "../_components/EscrowIcons";
import { EscrowPrototypeNotice } from "../_components/EscrowPrototypeNotice";
import { EscrowRules } from "../_components/EscrowRules";
import { EscrowStatusBadge } from "../_components/EscrowStatusBadge";
import { EscrowTimeline } from "../_components/EscrowTimeline";
import { computeEscrowAmounts } from "../_lib/escrow-amounts";
import {
  createEscrowFixtures,
  findEscrowFixture,
  type EscrowFixtureId,
} from "../_lib/escrow-fixtures";
import {
  applyEscrowTransition,
  buildEscrowTimeline,
  ESCROW_CONDITION_LABEL,
  ESCROW_STATUS_META,
  getEscrowActions,
  isDeadlinePassed,
  type EscrowTransition,
} from "../_lib/escrow-status";
import type { EscrowDeal, EscrowRole } from "../_lib/escrow-types";
import { EscrowActionPanel, type SettlementProposal } from "./EscrowActionPanel";

type PrototypeState = {
  clockMs: number;
  deal: EscrowDeal;
  flash: null | string;
  offsetMs: number;
  proposal: null | SettlementProposal;
  role: EscrowRole;
};

const MINUTE_MS = 60 * 1000;

export function EscrowDealClient({ id }: { id: EscrowFixtureId }) {
  const router = useRouter();
  const [state, setState] = useState<null | PrototypeState>(null);

  const reset = useCallback(() => {
    const now = Date.now();
    const fixture = findEscrowFixture(id, now);
    if (!fixture) return;
    setState({
      clockMs: now,
      deal: fixture.deal,
      flash: null,
      offsetMs: 0,
      proposal: null,
      role: fixture.defaultRole,
    });
  }, [id]);

  // Fixtures use the viewer's clock, so build them after mount and keep the countdown ticking.
  useEffect(() => {
    reset();
    const timer = window.setInterval(() => {
      setState((current) => current && { ...current, clockMs: Date.now() });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [reset]);

  if (!state) {
    return (
      <main className="main-wide escrow-layout">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading...
          </p>
        </section>
      </main>
    );
  }

  const { deal, role } = state;
  const nowMs = state.clockMs + state.offsetMs;
  const amounts = computeEscrowAmounts(deal);
  const deadlinePassed = isDeadlinePassed(deal, nowMs);
  const actions = getEscrowActions(deal.status, role, deadlinePassed, deal.shipment !== null);

  function runTransition(transition: EscrowTransition, message: string) {
    if (!state) return;
    try {
      const next = applyEscrowTransition(state.deal, state.role, transition, nowMs);
      setState({ ...state, deal: next, flash: message, proposal: null });
    } catch (error) {
      setState({
        ...state,
        flash: error instanceof Error ? error.message : "That step is not available.",
      });
    }
  }

  function skipPastDeadline() {
    if (!state?.deal.releaseDeadline) return;
    const target = Date.parse(state.deal.releaseDeadline) + MINUTE_MS;
    setState({ ...state, flash: null, offsetMs: Math.max(target - state.clockMs, 0) });
  }

  const exampleDeals = createEscrowFixtures(state.clockMs).map((fixture) => fixture.deal);
  const canSkipDeadline =
    deal.releaseDeadline !== null && !deadlinePassed && deal.status === "active";

  return (
    <main className="main-wide escrow-layout">
      <EscrowPrototypeNotice />

      <details className="card card-muted escrow-prototype-controls">
        <summary>Prototype controls: switch perspective, example or time</summary>
        <div className="escrow-prototype-controls-body">
          <div className="form-field">
            <span className="label" id="escrow-role-label">
              View as
            </span>
            <div aria-labelledby="escrow-role-label" className="type-segmented" role="group">
              {(["buyer", "seller"] as const).map((option) => (
                <button
                  aria-pressed={role === option}
                  className={`type-segment${role === option ? " type-segment-active" : ""}`}
                  key={option}
                  onClick={() => setState({ ...state, flash: null, role: option })}
                  type="button"
                >
                  {option === "buyer" ? "Buyer" : "Seller"}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field">
            <label className="label" htmlFor="escrow-example-select">
              Example deal
            </label>
            <select
              id="escrow-example-select"
              onChange={(event) => router.push(`/escrow/${event.target.value}`)}
              value={deal.id}
            >
              {exampleDeals.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.title} ({ESCROW_STATUS_META[example.status].label})
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <button
              className="btn"
              disabled={!canSkipDeadline}
              onClick={skipPastDeadline}
              type="button"
            >
              Jump past the deadline
            </button>
            <button className="btn" onClick={reset} type="button">
              Reset example
            </button>
          </div>
        </div>
      </details>

      <header className="card card-accent escrow-deal-header">
        <div className="row row-between">
          <span className="link-type-pill">Escrow link · {deal.reference}</span>
          <EscrowStatusBadge status={deal.status} />
        </div>
        <h1>{deal.title}</h1>
        <p className="escrow-deal-meta">
          Sold by @{deal.sellerUsername} · {ESCROW_CONDITION_LABEL[deal.condition]} ·{" "}
          {deal.releaseWindowDays}-day release window
        </p>
        <p className="escrow-role-chip">
          You are the <strong>{role}</strong>
        </p>
      </header>

      <div className="escrow-deal-grid">
        <aside aria-label="Your next step" className="escrow-deal-aside">
          <EscrowActionPanel
            actions={actions}
            amounts={amounts}
            deadlinePassed={deadlinePassed}
            deal={deal}
            flash={state.flash}
            key={`${deal.status}-${role}`}
            nowMs={nowMs}
            onProposalChange={(proposal) => setState({ ...state, flash: null, proposal })}
            onTransition={runTransition}
            proposal={state.proposal}
            role={role}
          />
        </aside>

        <div className="escrow-deal-main">
          <section aria-labelledby="escrow-timeline-heading" className="card">
            <span className="label">Progress</span>
            <h2 id="escrow-timeline-heading">Where this deal stands</h2>
            <EscrowTimeline steps={buildEscrowTimeline(deal)} />
          </section>

          <section aria-labelledby="escrow-deal-heading" className="card">
            <span className="label">The deal</span>
            <h2 id="escrow-deal-heading">What was agreed</h2>
            <div
              aria-label="No photos were added to this example deal"
              className="escrow-photo-placeholder"
              role="img"
            >
              <PackageIcon />
            </div>
            <p className="escrow-deal-description">{deal.description}</p>
            {deal.shipment ? (
              <p className="escrow-shipment-line">
                Shipped with {deal.shipment.carrier}
                {deal.shipment.trackingNumber ? (
                  <>
                    {" "}
                    · Tracking <span className="value-mono">{deal.shipment.trackingNumber}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </section>

          <section aria-labelledby="escrow-amounts-heading" className="card">
            <span className="label">Amounts</span>
            <h2 id="escrow-amounts-heading">What is locked</h2>
            <EscrowAmountBreakdown amounts={amounts} role={role} />
          </section>

          <section aria-labelledby="escrow-rules-heading" className="card">
            <span className="label">The rules</span>
            <h2 id="escrow-rules-heading">How this escrow works</h2>
            <EscrowRules releaseWindowDays={deal.releaseWindowDays} />
          </section>
        </div>
      </div>

      <section className="card card-muted">
        <p className="muted" style={{ margin: 0 }}>
          <Link href="/escrow">← All escrow links</Link>
        </p>
      </section>
    </main>
  );
}
