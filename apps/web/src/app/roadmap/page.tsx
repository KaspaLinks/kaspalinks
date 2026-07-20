import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ROADMAP_DESCRIPTION =
  "Kaspa Links roadmap — what's live and what's next: claimable links, claim drops, multi-recipient splits, time-locked refunds, and recurring subscriptions.";

export const metadata: Metadata = {
  alternates: { canonical: "/roadmap" },
  description: ROADMAP_DESCRIPTION,
  openGraph: {
    description: ROADMAP_DESCRIPTION,
    title: "Roadmap",
    type: "website",
    url: "/roadmap",
  },
  title: "Roadmap",
  twitter: {
    card: "summary_large_image",
    description: ROADMAP_DESCRIPTION,
    title: "Roadmap",
  },
};

export default function RoadmapPage() {
  return (
    <main className="main-wide roadmap-page">
      <section className="hero" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <span className="hero-eyebrow">Roadmap</span>
        <h1 className="hero-title" style={{ fontSize: "2rem" }}>
          What&apos;s coming next.
        </h1>
        <p className="hero-sub">
          Today Kaspa Links does payment links, creator profiles, real on-chain detection, and
          claimable links — including multi-link Claim Drops. The next features build on the same
          non-custodial idea: clear payment intent first, wallet-controlled execution second.
        </p>
      </section>

      {/* Live today — shipped feature list paired with the rollout note so the
          reader gets both "this works" and "here's how the next batch joins"
          on the same screen. */}
      <section className="roadmap-section">
        <header className="roadmap-section-header">
          <span className="roadmap-section-eyebrow roadmap-section-eyebrow-live">Live today</span>
          <h2 className="roadmap-section-title">Already shipped</h2>
        </header>
        <div className="roadmap-section-grid roadmap-section-grid-live">
          <article className="card card-accent">
            <h3 className="roadmap-feature-title">What works right now</h3>
            <ul style={{ margin: 0 }}>
              <li>Tip, donation, invoice and transfer links</li>
              <li>Fixed-amount and variable-amount (&ldquo;pay what you want&rdquo;) flows</li>
              <li>Real on-chain detection — status flips to CONFIRMED automatically</li>
              <li>KasWare extension pay on desktop</li>
              <li>Mobile deep-links + QR for Kaspium and other wallets</li>
              <li>Single Claimable links with a private refund path if they expire unclaimed</li>
              <li>Claim Drops with up to 10 individually shareable and refundable links</li>
              <li>Embed-button package and a kaspa-actions SDK</li>
              <li>Self-hostable on a single VPS via Docker Compose</li>
            </ul>
          </article>

          <article className="card card-muted roadmap-rollout">
            <h3 className="roadmap-feature-title">How we&apos;ll roll it out</h3>
            <p className="muted" style={{ margin: 0 }}>
              Claimable links and Claim Drops are the first on-chain programmable link types. Future
              features ship into the existing creator workflow as they clear testing - same
              dashboard, same account, and no parallel app. Existing links keep working unchanged.
            </p>
          </article>
        </div>
      </section>

      {/* Next — covenant-backed primitives that are not live yet. */}
      <section className="roadmap-section">
        <header className="roadmap-section-header">
          <span className="roadmap-section-eyebrow roadmap-section-eyebrow-next">Next</span>
          <h2 className="roadmap-section-title">Building toward this</h2>
        </header>
        <div className="roadmap-section-grid roadmap-section-grid-2">
          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Splits &amp; multi-recipient</h3>
            <p>
              One payment, multiple recipients. Set fixed shares (e.g. 60% / 30% / 10%) or fixed KAS
              amounts per recipient. The chain handles the split atomically, no off-chain
              coordination needed.
            </p>
            <p className="muted roadmap-feature-usecase">
              Use cases: team tipping (3 devs share royalties), collaboration payouts, donation
              splits between charity + project.
            </p>
          </article>

          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Advanced recovery rules</h3>
            <p>
              Claimable links already unlock a private, browser-signed refund after expiry. The next
              step is more flexible recovery windows and wallet-controlled recovery policies without
              introducing custody.
            </p>
            <p className="muted roadmap-feature-usecase">
              Use cases: time-limited bounties, event prizes, and longer-running reward campaigns.
            </p>
          </article>
        </div>
      </section>

      {/* Later — bigger features that need more design + research. Kept
          deliberately sparse on use-case detail because the shape is still
          fluid. */}
      <section className="roadmap-section">
        <header className="roadmap-section-header">
          <span className="roadmap-section-eyebrow roadmap-section-eyebrow-later">Later</span>
          <h2 className="roadmap-section-title">On the horizon</h2>
        </header>
        <div className="roadmap-section-grid roadmap-section-grid-2">
          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Recurring &amp; subscriptions</h3>
            <p>
              Set up a link that pulls a fixed amount on a schedule — Patreon-style support that
              runs entirely on-chain, no platform between supporter and creator.
            </p>
          </article>

          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Conditional release &amp; escrow</h3>
            <p>
              Multi-sig approvals, milestones, oracle-gated payouts. Use Kaspa covenants as
              programmable money primitives — release on signature, on time, or on external proof.
            </p>
          </article>
        </div>
      </section>

      <section className="card">
        <p style={{ margin: 0 }}>
          <Link href="/">← Back to home</Link>
        </p>
      </section>
    </main>
  );
}
