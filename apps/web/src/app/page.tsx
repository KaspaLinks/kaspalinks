import Link from "next/link";

import { HeroQuickStart } from "./HeroQuickStart";

export const dynamic = "force-dynamic";

// The same four jobs as the Telegram Mini App start screen, so the web and the
// bot read as one product.
const START_TILES = [
  {
    body: "Tips, donations, goals or invoices, paid straight to your wallet.",
    cta: "Create a payment link",
    href: "/new-link?start=paid",
    title: "Get paid",
  },
  {
    body: "A claim link for one person, or a drop of up to 8. Unclaimed KAS comes back by itself.",
    cta: "Create a claim link",
    href: "/claim/create",
    title: "Send KAS",
  },
  {
    body: "Fund a prize, share one link, and a fair on-chain draw picks the winner.",
    cta: "Start a giveaway",
    href: "/giveaway/new",
    title: "Run a giveaway",
  },
] as const;

function telegramBotUrl(): null | string {
  const username = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") ?? "";
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? `https://t.me/${username}` : null;
}

export default function Home() {
  const botUrl = telegramBotUrl();
  return (
    <main className="main-wide">
      <section className="hero hero-split">
        <div className="hero-copy">
          <span className="hero-eyebrow">Shareable Kaspa payment links</span>
          <h1 className="hero-title">
            Turn Kaspa payments
            <br />
            into shareable links.
          </h1>
          <p className="hero-sub">
            Get paid, send KAS with a link, or run a giveaway. Non-custodial by design: your wallet,
            your keys, your funds.
          </p>
          <HeroQuickStart />
          <p className="hero-no-account">No account, no email, no platform fee.</p>
          <p className="hero-more-links">
            <Link href="/new-link">All link types</Link> ·{" "}
            <Link href="/try-it-out">How it works</Link> ·{" "}
            <Link href="/what-is-kaspa">New to Kaspa?</Link>
          </p>
        </div>
        <div className="hero-visual">
          {/* Landing demo — a visual mockup of an actual Kaspa Links pay-page.
              Pure decoration: no buttons inside fire, no copy logic, no wallet.
              The whole frame is a single <Link> to /try-it-out so anyone who
              wants to actually interact can do so. The PENDING → CONFIRMED
              pill animates live to demonstrate the on-chain detection. */}
          <Link
            aria-label="See what a Kaspa Links pay page looks like, then try it out"
            className="landing-demo"
            href="/try-it-out"
          >
            <span className="landing-demo-eyebrow">See what supporters see</span>
            <div className="landing-demo-frame">
              <div className="landing-demo-chrome">
                <span className="landing-demo-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="landing-demo-url">
                  kaspalinks.com<span className="landing-demo-url-path">/u/alice/coffee</span>
                  <span className="landing-demo-url-cursor" aria-hidden="true" />
                </span>
              </div>
              <div className="landing-demo-content">
                <div className="landing-demo-card landing-demo-card-header">
                  <span className="link-type-pill landing-demo-pill">Tip</span>
                  <h3>Buy me a coffee</h3>
                  <p className="muted">&ldquo;:-) Thanks for the open-source work.&rdquo;</p>
                </div>

                {/* Pay-state and success-state cross-fade on an 8-second loop
                    to demonstrate the entire flow — same shape as what happens
                    on a real /a/[publicId] page when the indexer detects the
                    tx. Two stacked variants of the card via grid; CSS handles
                    the fade. */}
                <div className="landing-demo-card landing-demo-flip" aria-hidden="true">
                  <div className="landing-demo-flip-pay">
                    <span className="label">Amount</span>
                    <div className="landing-demo-amount">
                      <span className="landing-demo-amount-main">5</span>
                      <span className="landing-demo-amount-unit">KAS</span>
                    </div>

                    <div className="landing-demo-divider" />

                    <span className="label">To</span>
                    <div className="landing-demo-recipient">
                      <span className="value-mono">kaspa:qpy6l7q6apd...ecd09de4en</span>
                      <span className="landing-demo-mock-btn">Copy</span>
                    </div>

                    {/* Pay button — two text states stacked. Default "Pay with
                        KasWare" shows initially; "Confirming…" with spinner
                        takes over after the simulated cursor click. */}
                    <div className="landing-demo-pay">
                      <span className="landing-demo-pay-text-default">Pay with KasWare</span>
                      <span className="landing-demo-pay-text-confirming">
                        <span className="landing-demo-pay-spinner" aria-hidden="true" />
                        Confirming…
                      </span>
                    </div>

                    <div className="landing-demo-status">
                      {/* PENDING + CONFIRMED pills are stacked in one grid cell;
                          CSS swaps them at ~3.2 s into the loop so the demo
                          shows PENDING → ✓ CONFIRMED → Thank-you-hero as a
                          single narrative rather than a flicker. The
                          deck-status-pill base classes only carry the
                          visual styling — the per-pill loop animation they
                          ship with is overridden below in globals.css. */}
                      <span className="landing-demo-status-pills">
                        <span className="landing-demo-status-pending deck-status-pill deck-status-pill-pending">
                          <span className="deck-status-dot" />
                          PENDING
                        </span>
                        <span className="landing-demo-status-confirmed deck-status-pill deck-status-pill-confirmed">
                          ✓ CONFIRMED
                        </span>
                      </span>
                      <span className="landing-demo-status-caption">Live on-chain detection</span>
                    </div>

                    {/* Simulated cursor that approaches the Pay button, clicks,
                        and disappears as the card transitions to success.
                        Pure decoration — no pointer events, ignored by a11y. */}
                    <span className="landing-demo-cursor" aria-hidden="true">
                      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path
                          d="M4 3 L4 18 L8 14 L11 21 L14 19 L11 13 L17 13 Z"
                          fill="#ffffff"
                          stroke="#0b1116"
                          strokeWidth="1.2"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                  </div>

                  <div className="landing-demo-flip-success">
                    <div className="landing-demo-success-check">
                      <svg
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                        viewBox="0 0 24 24"
                      >
                        <polyline points="5 13 10 18 19 7" />
                      </svg>
                    </div>
                    <h4 className="landing-demo-success-title">Thank you!</h4>
                    <p className="landing-demo-success-amount">
                      <strong>5</strong> <span>KAS received</span>
                    </p>
                    <p className="landing-demo-success-note">Confirmed on the Kaspa network.</p>
                    <div className="landing-demo-success-tx">
                      <span className="label">Transaction</span>
                      <p className="value-mono">
                        a8b3c00bd3...8149a9 ·{" "}
                        <span className="landing-demo-success-tx-link">View on Kaspa.stream</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <span className="landing-demo-cta">How it works →</span>
          </Link>
        </div>
      </section>

      <section aria-label="What you can do" className="home-start">
        <div className="home-start-grid">
          {START_TILES.map((tile) => (
            <Link className="home-start-tile" href={tile.href} key={tile.href}>
              <strong>{tile.title}</strong>
              <span>{tile.body}</span>
              <span className="home-start-cta">{tile.cta} →</span>
            </Link>
          ))}
        </div>
        {botUrl ? (
          <p className="home-start-telegram">
            Also in Telegram: the same links and giveaways from a chat.{" "}
            <a href={botUrl} rel="noreferrer" target="_blank">
              Open the bot →
            </a>
          </p>
        ) : null}
      </section>

      <section className="why">
        <h2 className="why-heading">Why Kaspa Links?</h2>
        <ul className="why-list why-list-compact">
          <li className="why-item">
            <span className="feature-dot" aria-hidden="true" />
            <div>
              <strong className="why-item-lead">Straight to your wallet.</strong>
              <p className="why-item-body">No middleman, no platform fee, no payout delay.</p>
            </div>
          </li>
          <li className="why-item">
            <span className="feature-dot" aria-hidden="true" />
            <div>
              <strong className="why-item-lead">Confirmed in a second.</strong>
              <p className="why-item-body">Supporters see CONFIRMED before they switch tabs.</p>
            </div>
          </li>
          <li className="why-item">
            <span className="feature-dot" aria-hidden="true" />
            <div>
              <strong className="why-item-lead">Open source.</strong>
              <p className="why-item-body">Audit it or host it yourself. No tracking, no email.</p>
            </div>
          </li>
        </ul>
        <p className="home-examples">
          Ideas: a <Link href="/try-it-out#creators">tip jar</Link>, an{" "}
          <Link href="/try-it-out#freelancers">invoice</Link>, a{" "}
          <Link href="/try-it-out#goals">fundraising goal</Link> or a{" "}
          <Link href="/try-it-out#claimable">claim drop</Link>.
        </p>
      </section>

      <p className="home-footnote muted">
        Not a wallet and never custody: Kaspa Links only builds the links.{" "}
        <Link href="/roadmap">Roadmap</Link> · <Link href="/deck">Pitch</Link>
      </p>
    </main>
  );
}
