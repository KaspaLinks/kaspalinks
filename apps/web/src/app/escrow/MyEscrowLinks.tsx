"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { EscrowDealRow } from "./_components/EscrowDealRow";
import { createEscrowFixtures, type EscrowFixture } from "./_lib/escrow-fixtures";
import { isEscrowClosed } from "./_lib/escrow-status";
import { useCreatorSession } from "./_lib/use-creator-session";

type Filter = "active" | "closed";

export function MyEscrowLinks() {
  const session = useCreatorSession();
  const [fixtures, setFixtures] = useState<EscrowFixture[] | null>(null);
  const [filter, setFilter] = useState<Filter>("active");

  // Built after mount so relative dates match the viewer's clock.
  useEffect(() => {
    setFixtures(createEscrowFixtures(Date.now()));
  }, []);

  if (!session.hydrated || !fixtures) {
    return (
      <section className="card">
        <p className="muted" style={{ margin: 0 }}>
          Loading...
        </p>
      </section>
    );
  }

  const deals = fixtures
    .map((fixture) => fixture.deal)
    .filter((deal) => isEscrowClosed(deal.status) === (filter === "closed"));

  return (
    <section aria-labelledby="my-escrow-links-heading" className="card">
      <div className="row row-between escrow-list-header">
        <div>
          <span className="label">{session.signedIn ? "Your escrow links" : "Example deals"}</span>
          <h2 id="my-escrow-links-heading">
            {session.signedIn ? "Deals you are selling" : "Walk through a deal"}
          </h2>
        </div>
        <div aria-label="Filter escrow links" className="type-segmented" role="group">
          {(["active", "closed"] as const).map((option) => (
            <button
              aria-pressed={filter === option}
              className={`type-segment${filter === option ? " type-segment-active" : ""}`}
              key={option}
              onClick={() => setFilter(option)}
              type="button"
            >
              {option === "active" ? "Active" : "Closed"}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        {session.signedIn
          ? "Example data for the prototype. Real escrow links will appear here once they exist on chain."
          : "Open any example to see each step as buyer or seller."}
      </p>
      <ul className="escrow-deal-list">
        {deals.map((deal) => (
          <EscrowDealRow deal={deal} key={deal.id} />
        ))}
      </ul>
      {session.signedIn ? null : (
        <p className="muted escrow-list-footer">
          Selling something? <Link href="/sign-in?next=%2Fescrow%2Fnew">Sign in</Link> to create an
          escrow link.
        </p>
      )}
    </section>
  );
}
