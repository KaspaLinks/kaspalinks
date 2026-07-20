import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo } from "../BrandLogo";
import { Slide } from "./Slide";

export const dynamic = "force-dynamic";

const DECK_DESCRIPTION =
  "Kaspa Links explained in 10 slides — how shareable, non-custodial Kaspa payment links work and why they beat traditional crypto payment processors.";

export const metadata: Metadata = {
  alternates: { canonical: "/deck" },
  description: DECK_DESCRIPTION,
  openGraph: {
    description: DECK_DESCRIPTION,
    title: "Deck",
    type: "website",
    url: "/deck",
  },
  title: "Deck",
  twitter: {
    card: "summary_large_image",
    description: DECK_DESCRIPTION,
    title: "Deck",
  },
};

/**
 * /deck — a 10-slide pitch deck for sharing on X and embedding on the
 * website. Each slide is full-viewport on desktop (16:9-ish) with CSS
 * scroll-snap, so:
 *   - Keyboard / PageDown / arrow keys advance one slide at a time
 *   - Right-click → "Save image" works on screenshots
 *   - Cmd+P prints a clean PDF (one slide per page) via @media print
 *
 * The whole route hides the global brand-bar + footer (via :has() in
 * globals.css) so the deck reads as a presentation, not a webpage with
 * chrome around it.
 */
export default function DeckPage() {
  return (
    <main className="deck-main">
      <Slide index={1} of={10}>
        <article className="deck-slide deck-slide-hero">
          <div className="deck-hero-lockup">
            <BrandLogo variant="hero" />
          </div>
          <p className="deck-hero-sub">
            Turn Kaspa payments into shareable links.
            <br />
            <span>Non-custodial. On-chain. Wallet-to-wallet.</span>
          </p>
          <p className="deck-hero-url">kaspalinks.com</p>
          <p className="deck-navigation-hint">Scroll, swipe, or use the arrow keys to continue ↓</p>
        </article>
      </Slide>

      <Slide index={2} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">The pain</span>
          <h2 className="deck-title">
            Payment links are everywhere.
            <br />
            <span className="deck-title-accent">So is the middleman.</span>
          </h2>
          <ul className="deck-list">
            <li>
              <strong>Stripe / PayPal</strong>
              {" hold your money for 7–30 days. They can freeze your account on a phone call."}
            </li>
            <li>
              <strong>Patreon</strong>
              {" dictates rules, censors creators, and takes 8–12% off the top."}
            </li>
            <li>
              <strong>Every &ldquo;buy me a coffee&rdquo; clone</strong>
              {" sits between you and your supporter, forever."}
            </li>
          </ul>
          <p className="deck-takeaway">
            You&apos;re renting a payment relationship that should be yours.
          </p>
        </article>
      </Slide>

      <Slide index={3} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">The crypto detour</span>
          <h2 className="deck-title">
            Crypto tried to fix this.
            <br />
            <span className="deck-title-accent">Mostly traded one custodian for another.</span>
          </h2>
          <div className="deck-compare">
            <div className="deck-compare-row">
              <span className="deck-compare-label">BTCPay Server</span>
              <span className="deck-compare-value">Run your own node + Docker stack</span>
            </div>
            <div className="deck-compare-row">
              <span className="deck-compare-label">OpenNode</span>
              <span className="deck-compare-value">KYC. Custodial. API fees.</span>
            </div>
            <div className="deck-compare-row">
              <span className="deck-compare-label">NowPayments</span>
              <span className="deck-compare-value">Custody + chain fees + platform fees</span>
            </div>
          </div>
          <p className="deck-takeaway">
            Either too technical for normies, or just centralized payments with extra steps.
          </p>
        </article>
      </Slide>

      <Slide index={4} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">What it is</span>
          <h2 className="deck-title">
            Kaspa Links is a URL.
            <br />
            <span className="deck-title-accent">That&apos;s the whole product.</span>
          </h2>
          <p className="deck-url-example">
            kaspalinks.com<span>/u/alice/coffee</span>
          </p>
          <ul className="deck-list deck-list-tight">
            <li>
              One link bundles a <strong>recipient address</strong>, an{" "}
              <strong>optional amount</strong>, and an <strong>optional message</strong>.
            </li>
            <li>
              Paid <strong>wallet-to-wallet</strong>. Confirmed on-chain in seconds.
            </li>
            <li>No supporter account. No checkout. No middleman.</li>
          </ul>
        </article>
      </Slide>

      <Slide index={5} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">How it works</span>
          <h2 className="deck-title">Three steps. Zero supporter accounts.</h2>
          <ol className="deck-steps">
            <li>
              <span className="deck-step-num">1</span>
              <div>
                <strong>Creator</strong> drops their <code>kaspa:</code> address into{" "}
                <code>/new-link</code> → gets a shareable URL.
              </div>
            </li>
            <li>
              <span className="deck-step-num">2</span>
              <div>
                <strong>Supporter</strong> opens the link, pays with the KasWare extension on
                desktop or scans the QR with Kaspium on mobile.
              </div>
            </li>
            <li>
              <span className="deck-step-num">3</span>
              <div>
                <strong>Status flips PENDING → CONFIRMED</strong> automatically once the transaction
                lands on-chain — usually within a few seconds. The page updates itself; nobody has
                to reload anything.
                <span className="deck-status-flip" aria-hidden="true">
                  <span className="deck-status-pill deck-status-pill-pending">
                    <span className="deck-status-dot" />
                    PENDING
                  </span>
                  <span className="deck-status-pill deck-status-pill-confirmed">✓ CONFIRMED</span>
                </span>
              </div>
            </li>
          </ol>
        </article>
      </Slide>

      <Slide index={6} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">Why Kaspa</span>
          <h2 className="deck-title">
            Most chains can&apos;t do this.
            <br />
            <span className="deck-title-accent">Kaspa was built for it.</span>
          </h2>
          <div className="deck-chain-compare">
            <div className="deck-chain-row deck-chain-row-slow">
              <span className="deck-chain-name">Bitcoin</span>
              <span className="deck-chain-time">~10 minutes</span>
              <span className="deck-chain-verdict">Supporter closed the tab</span>
            </div>
            <div className="deck-chain-row deck-chain-row-mid">
              <span className="deck-chain-name">Ethereum</span>
              <span className="deck-chain-time">~12s + variable gas</span>
              <span className="deck-chain-verdict">Unpredictable UX</span>
            </div>
            <div className="deck-chain-row deck-chain-row-fast">
              <span className="deck-chain-name">Kaspa</span>
              <span className="deck-chain-time">~10s fully confirmed</span>
              <span className="deck-chain-verdict">
                0.1s block time · Built for real-time payment UX
              </span>
            </div>
          </div>
          <p className="deck-takeaway">BlockDAG + PoW. No validator gatekeeping.</p>
        </article>
      </Slide>

      <Slide index={7} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">Non-custodial</span>
          <h2 className="deck-title">
            We never touch your funds.
            <br />
            <span className="deck-title-accent">Can&apos;t freeze. Can&apos;t reverse.</span>
          </h2>
          <ul className="deck-list deck-list-check">
            <li>The tx is broadcast by the supporter&apos;s wallet, not ours.</li>
            <li>
              Funds go straight to your <code>kaspa:</code> address.
            </li>
            <li>Kaspa Links has no signing key, no custody, no admin override.</li>
            <li>Self-hostable on a single VPS via Docker Compose.</li>
          </ul>
          <p className="deck-takeaway">
            Payments are wallet-standard URIs underneath. Your funds never depend on our custody,
            signing, or admin access.
          </p>
        </article>
      </Slide>

      <Slide index={8} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">Built for</span>
          <h2 className="deck-title">Anyone who&apos;s tired of platform fees.</h2>
          <div className="deck-audience-grid">
            <div className="deck-audience">
              <span className="deck-audience-tag">Streamers &amp; creators</span>
              <p>On-screen tip QR. Confirmed before the next song. Goes straight to your wallet.</p>
            </div>
            <div className="deck-audience">
              <span className="deck-audience-tag">Freelancers</span>
              <p>One link, fixed amount, on-chain proof of payment. Beats invoicing software.</p>
            </div>
            <div className="deck-audience">
              <span className="deck-audience-tag">Communities &amp; DAOs</span>
              <p>Pooled donations, treasury contributions, transparent flows.</p>
            </div>
            <div className="deck-audience">
              <span className="deck-audience-tag">Developers</span>
              <p>Embed-button + kaspa-actions SDK. Drop into any site, any framework.</p>
            </div>
          </div>
        </article>
      </Slide>

      <Slide index={9} of={10}>
        <article className="deck-slide">
          <span className="deck-eyebrow">Programmable links</span>
          <h2 className="deck-title">
            On-chain rewards are <span className="deck-title-accent">live</span>.
          </h2>
          <p className="deck-sub">
            Claimable links and multi-link Claim Drops add wallet-to-wallet rewards without turning
            Kaspa Links into a custodian.
          </p>
          <ul className="deck-list deck-list-arrow">
            <li>
              <strong>Claimable links</strong> — One reward, first valid claim wins.
            </li>
            <li>
              <strong>Claim Drops</strong> — Up to 10 separate rewards, funded in one batch.
            </li>
            <li>
              <strong>Private recovery</strong> — Refund each unclaimed link after expiry.
            </li>
            <li>
              <strong>Next</strong> — Splits, pay-to-unlock, and recurring support.
            </li>
          </ul>
        </article>
      </Slide>

      <Slide index={10} of={10}>
        <article className="deck-slide deck-slide-cta">
          <span className="deck-eyebrow">Try it</span>
          <h2 className="deck-title">
            Try it. Share it.
            <br />
            <span className="deck-title-accent">Self-host it.</span>
          </h2>
          <div className="deck-cta-grid">
            <Link className="deck-cta deck-cta-primary" href="/try-it-out">
              <span className="deck-cta-arrow">→</span>
              <span className="deck-cta-label">Try a link</span>
              <span className="deck-cta-url">kaspalinks.com/try-it-out</span>
            </Link>
            <Link className="deck-cta" href="/roadmap">
              <span className="deck-cta-arrow">→</span>
              <span className="deck-cta-label">Read the roadmap</span>
              <span className="deck-cta-url">kaspalinks.com/roadmap</span>
            </Link>
            <a
              className="deck-cta"
              href="https://github.com/KaspaLinks/kaspalinks"
              rel="noreferrer"
              target="_blank"
            >
              <span className="deck-cta-arrow">→</span>
              <span className="deck-cta-label">Public codebase</span>
              <span className="deck-cta-url">github.com/KaspaLinks/kaspalinks</span>
            </a>
          </div>
          <p className="deck-cta-footer">Built on Kaspa · Non-custodial by design · Open source</p>
        </article>
      </Slide>
    </main>
  );
}
