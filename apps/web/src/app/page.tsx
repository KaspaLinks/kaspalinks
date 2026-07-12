import Link from "next/link";

import { BrandLogo } from "./BrandLogo";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="main-wide">
      <section className="hero">
        <div className="hero-brand">
          <BrandLogo variant="hero" />
        </div>
        <span className="hero-eyebrow">Shareable Kaspa payment links</span>
        <h1 className="hero-title">
          Turn Kaspa payments
          <br />
          into shareable links.
        </h1>
        <p className="hero-sub">
          Tip a creator, crowdfund a goal, pay an invoice — with one URL, a QR, and a clear intent.
          Non-custodial by design. Your wallet, your keys, your funds.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href="/try-it-out" className="btn btn-primary">
            Try it out
          </Link>
          <Link href="/deck" className="btn">
            Read the pitch →
          </Link>
        </div>
        {/* Newcomer escape hatch — anyone who landed here from a shared
            link without knowing what Kaspa is gets a clear way out to a
            60-second intro. Kept understated on purpose so it doesn't
            compete with the CTAs above. */}
        <p className="hero-newcomer-link">
          <Link href="/what-is-kaspa">New to Kaspa? See what makes it fast →</Link>
        </p>
      </section>

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
        <span className="landing-demo-cta">Try it yourself →</span>
      </Link>

      <section className="why">
        <h2 className="why-heading">Why Kaspa Links?</h2>
        <ul className="why-list">
          <li className="why-item">
            <span className="feature-dot" aria-hidden="true" />
            <div>
              <strong className="why-item-lead">Direct, no middleman.</strong>
              <p className="why-item-body">
                Payments go from your supporter&apos;s wallet to yours, period. No platform fees, no
                payout delays, no account freezes, no chargebacks.
              </p>
            </div>
          </li>
          <li className="why-item">
            <span className="feature-dot" aria-hidden="true" />
            <div>
              <strong className="why-item-lead">Just paste, just scan.</strong>
              <p className="why-item-body">
                A 60-character Kaspa address is unreadable. A link with recipient, amount, and
                message pre-filled is one tap or one scan away from done.
              </p>
            </div>
          </li>
          <li className="why-item">
            <span className="feature-dot" aria-hidden="true" />
            <div>
              <strong className="why-item-lead">Built for Kaspa speed.</strong>
              <p className="why-item-body">
                Kaspa confirms in under a second. Your supporter sees CONFIRMED before they switch
                tabs.
              </p>
            </div>
          </li>
          <li className="why-item">
            <span className="feature-dot" aria-hidden="true" />
            <div>
              <strong className="why-item-lead">Open-source, self-hostable.</strong>
              <p className="why-item-body">
                Run it on your own VPS, audit every line, fork it. No vendor lock-in, no tracking,
                no email required.
              </p>
            </div>
          </li>
        </ul>
      </section>

      <section className="use-cases">
        <h2 className="use-cases-heading">Built for</h2>
        <div className="use-cases-grid">
          <Link className="use-case" href="/try-it-out#creators">
            <span className="use-case-icon" aria-hidden="true">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
              >
                <rect height="11" rx="3" width="6" x="9" y="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <line x1="12" x2="12" y1="18" y2="21" />
                <line x1="8" x2="16" y1="21" y2="21" />
              </svg>
            </span>
            <span className="use-case-tag">Streamers &amp; creators</span>
            <h3 className="use-case-title">Tips that just work</h3>
            <p className="use-case-body">
              Drop a tip link in your bio, or render the QR as an OBS overlay so live viewers can
              pay without leaving the stream.
            </p>
          </Link>
          <Link className="use-case" href="/try-it-out#freelancers">
            <span className="use-case-icon" aria-hidden="true">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
              >
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="14 3 14 9 20 9" />
                <line x1="8" x2="14" y1="13" y2="13" />
                <line x1="8" x2="16" y1="17" y2="17" />
              </svg>
            </span>
            <span className="use-case-tag">Freelancers</span>
            <h3 className="use-case-title">Send a clean invoice</h3>
            <p className="use-case-body">
              Issue a fixed-amount link; the page flips to CONFIRMED automatically once the
              transaction lands. No reconciliation by hand.
            </p>
          </Link>
          <Link className="use-case" href="/try-it-out#communities">
            <span className="use-case-icon" aria-hidden="true">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="5" r="2.2" />
                <circle cx="5" cy="17" r="2.2" />
                <circle cx="19" cy="17" r="2.2" />
                <line x1="11.2" x2="6.2" y1="6.9" y2="15.1" />
                <line x1="12.8" x2="17.8" y1="6.9" y2="15.1" />
                <line x1="7.2" x2="16.8" y1="17" y2="17" />
              </svg>
            </span>
            <span className="use-case-tag">Communities &amp; DAOs</span>
            <h3 className="use-case-title">Fund transparently</h3>
            <p className="use-case-body">
              Every payment is on-chain and publicly verifiable. No platform sitting between your
              treasury and your supporters.
            </p>
          </Link>
          <Link className="use-case" href="/try-it-out#goals">
            <span className="use-case-icon" aria-hidden="true">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="9" />
                <circle cx="12" cy="12" r="5" />
                <circle cx="12" cy="12" r="1.5" />
              </svg>
            </span>
            <span className="use-case-tag">Projects &amp; crowdfunding</span>
            <h3 className="use-case-title">Crowdfund toward a goal</h3>
            <p className="use-case-body">
              Set a target and let supporters pay what they want. A live progress bar shows how
              close you are — raised so far, percent funded, and supporter count.
            </p>
          </Link>
          <Link className="use-case" href="/try-it-out#developers">
            <span className="use-case-icon" aria-hidden="true">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
              >
                <polyline points="9 8 4 12 9 16" />
                <polyline points="15 8 20 12 15 16" />
                <line x1="14" x2="10" y1="6" y2="18" />
              </svg>
            </span>
            <span className="use-case-tag">Developers</span>
            <h3 className="use-case-title">Embed it anywhere</h3>
            <p className="use-case-body">
              Drop a &ldquo;Tip with Kaspa&rdquo; button on any page with the embed-button package,
              or build directly against the kaspa-actions SDK.
            </p>
          </Link>
          <Link className="use-case" href="/try-it-out#claimable">
            <span className="use-case-icon" aria-hidden="true">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
              >
                <polyline points="20 12 20 22 4 22 4 12" />
                <rect height="5" width="20" x="2" y="7" />
                <line x1="12" x2="12" y1="22" y2="7" />
                <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
              </svg>
            </span>
            <span className="use-case-tag">Gifts &amp; rewards</span>
            <h3 className="use-case-title">Claimable links</h3>
            <p className="use-case-body">
              Lock KAS into a one-time link. The first person to open it claims the funds, and you
              keep a private refund link if the timer expires unclaimed.
            </p>
          </Link>
        </div>
      </section>

      <section className="card card-muted">
        <h2 style={{ marginBottom: 6 }}>What this is not</h2>
        <p className="muted" style={{ margin: 0 }}>
          Not a wallet. Not custody. Not a payment processor in the legal sense. Payment links
          and real on-chain detection are live today. Claimable links are rolling out as an
          on-chain reward flow, while splits and advanced covenant features stay on the roadmap.
          <Link href="/roadmap"> See the full roadmap →</Link>
        </p>
      </section>
    </main>
  );
}
