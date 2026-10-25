import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";

const ROADMAP_DESCRIPTION =
  "Kaspa Links roadmap: what's live and what's next. Payment links, claim links and Claim Drops that return unclaimed KAS, on-chain giveaways, a Telegram bot, escrow links, splits and recurring support.";

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
          What&apos;s live, and what&apos;s next.
        </h1>
        <p className="hero-sub">
          Kaspa Links does payment links, claim links, Claim Drops, on-chain giveaways and a
          Telegram bot, most of it without an account. Everything new follows the same idea: a clear
          payment intent first, wallet-controlled execution second, and no custody.
        </p>
      </section>

      <section className="roadmap-section">
        <header className="roadmap-section-header">
          <span className="roadmap-section-eyebrow roadmap-section-eyebrow-live">Live today</span>
          <h2 className="roadmap-section-title">Already shipped</h2>
        </header>
        <div className="roadmap-section-grid roadmap-section-grid-2">
          <article className="card card-accent roadmap-feature">
            <h3 className="roadmap-feature-title">Payment links</h3>
            <ul style={{ margin: 0 }}>
              <li>Tip, donation, invoice, transfer and goal links</li>
              <li>Fixed or open amounts, entered in KAS, $ or €</li>
              <li>On-chain detection: the payer and the creator see the payment within seconds</li>
              <li>KasWare on desktop, Kaspium and other wallets by deep link and QR</li>
              <li>No account needed to create a link</li>
            </ul>
          </article>

          <article className="card card-accent roadmap-feature">
            <h3 className="roadmap-feature-title">Claim links &amp; Claim Drops</h3>
            <ul style={{ margin: 0 }}>
              <li>Send KAS with a link: the first valid claim gets it</li>
              <li>Claim Drops: up to 8 separate claim links, funded in one payment</li>
              <li>Unclaimed KAS comes back to you automatically after the claim window</li>
              <li>No recovery file, no account, no key held by Kaspa Links</li>
            </ul>
          </article>

          <article className="card card-accent roadmap-feature">
            <h3 className="roadmap-feature-title">On-chain giveaways</h3>
            <ul style={{ margin: 0 }}>
              <li>Any prize from 0.2 KAS, up to 32 participants</li>
              <li>Free to join with any Kaspa address</li>
              <li>Kaspa locks the list, a random block picks the winner</li>
              <li>Winner paid automatically by SilverScript, every step verifiable on-chain</li>
              <li>If nobody joins, the prize and unused reserve go back to you</li>
              <li>No account needed: start on the website and keep a private link</li>
            </ul>
          </article>

          <article className="card card-accent roadmap-feature">
            <h3 className="roadmap-feature-title">Telegram &amp; tools</h3>
            <ul style={{ margin: 0 }}>
              <li>@kaspalinksbot: create payment links, claim links and giveaways in a Mini App</li>
              <li>Payment and claim notices right in the chat</li>
              <li>Creator profiles with a public supporter wall and an OBS overlay for streams</li>
              <li>Embed button and SDK, open source, self-hostable with Docker Compose</li>
            </ul>
          </article>
        </div>
        <article className="card card-muted roadmap-rollout" style={{ marginTop: 12 }}>
          <h3 className="roadmap-feature-title">How new features roll out</h3>
          <p className="muted" style={{ margin: 0 }}>
            New link types run privately on mainnet first, then open to everyone in the same
            dashboard and the same bot. Existing links keep working unchanged.
          </p>
        </article>
      </section>

      <section className="roadmap-section">
        <header className="roadmap-section-header">
          <span className="roadmap-section-eyebrow roadmap-section-eyebrow-next">Next</span>
          <h2 className="roadmap-section-title">Building toward this</h2>
        </header>
        <div className="roadmap-section-grid roadmap-section-grid-2">
          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Escrow links · in private testing</h3>
            <p>
              Agree on a deal anywhere, then pay into an escrow only the buyer and seller can move.
              The buyer releases the KAS, the seller can refund it, and a deadline keeps it from
              getting stuck. Kaspa Links holds no key and takes no fee.
            </p>
            <p className="muted roadmap-feature-usecase">
              Use cases: private sales, freelance jobs, paying someone you have not met.
            </p>
          </article>

          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Cheaper giveaways</h3>
            <p>
              A leaner participant contract: every on-chain step gets smaller, so joining and
              closing cost less network fee and more of the reserve comes back to you.
            </p>
            <p className="muted roadmap-feature-usecase">
              Applies to new giveaways; running ones keep their committed terms.
            </p>
          </article>

          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Splits &amp; multi-recipient</h3>
            <p>
              One payment, several recipients. Set shares (e.g. 60% / 30% / 10%) or fixed KAS
              amounts per recipient, and the chain does the split in one transaction.
            </p>
            <p className="muted roadmap-feature-usecase">
              Use cases: team tips, collaboration payouts, donations shared between a charity and a
              project.
            </p>
          </article>
        </div>
      </section>

      <section className="roadmap-section">
        <header className="roadmap-section-header">
          <span className="roadmap-section-eyebrow roadmap-section-eyebrow-later">Later</span>
          <h2 className="roadmap-section-title">On the horizon</h2>
        </header>
        <div className="roadmap-section-grid roadmap-section-grid-2">
          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Recurring support</h3>
            <p>
              Support a creator every month, Patreon-style, straight from wallet to wallet with no
              platform in between.
            </p>
          </article>

          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Passkey lock for links without an account</h3>
            <p>
              Keep the private codes of links you created without an account behind a passkey, so
              they only open after you confirm with Face ID, a fingerprint or your device PIN.
            </p>
          </article>

          <article className="card roadmap-feature">
            <h3 className="roadmap-feature-title">Milestones &amp; conditional payouts</h3>
            <p>
              Release KAS in steps, on several signatures or on an external proof, built on the same
              covenants as escrow links.
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
