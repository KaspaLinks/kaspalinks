import type { Metadata } from "next";
import Link from "next/link";

import { BlockDagVisualizer } from "./BlockDagVisualizer";

export const dynamic = "force-dynamic";

const WHAT_IS_KASPA_DESCRIPTION =
  "Kaspa is a proof-of-work network that confirms payments in seconds and charges fractions of a cent in fees. Here's the 60-second intro.";

export const metadata: Metadata = {
  alternates: { canonical: "/what-is-kaspa" },
  description: WHAT_IS_KASPA_DESCRIPTION,
  openGraph: {
    description: WHAT_IS_KASPA_DESCRIPTION,
    title: "What is Kaspa?",
    type: "website",
    url: "/what-is-kaspa",
  },
  title: "What is Kaspa?",
  twitter: {
    card: "summary_large_image",
    description: WHAT_IS_KASPA_DESCRIPTION,
    title: "What is Kaspa?",
  },
};

/**
 * Newcomer-facing intro page. Linked from the landing-page hero and from
 * the brand nav under "What is Kaspa?". Kept narrow on purpose: the goal
 * is to answer "what is this thing my friend just sent me a link on" in
 * under a minute, not to be the canonical Kaspa explainer (kaspa.org
 * holds that title).
 *
 * The BlockDAG visualizer up top is the spine of the page — it carries
 * the "10 blocks per second, in parallel" point that distinguishes Kaspa
 * from Bitcoin and Ethereum without us needing to define BlockDAG in
 * paragraph form.
 */
export default function WhatIsKaspaPage() {
  return (
    <main className="main-wide what-is-kaspa-page">
      <section className="hero" style={{ paddingTop: 8, paddingBottom: 12 }}>
        <span className="hero-eyebrow">60-second intro</span>
        <h1 className="hero-title" style={{ fontSize: "2rem" }}>
          What is Kaspa?
        </h1>
        <p className="hero-sub">
          The fastest proof-of-work network in production. Payments confirm in seconds, fees are
          fractions of a cent, and you never give up custody of your coins.
        </p>
      </section>

      <BlockDagVisualizer />

      <section className="why what-is-kaspa-properties">
        <h2 className="why-heading">Why it matters for Kaspa Links</h2>
        <div className="why-grid">
          <article className="why-card">
            <span className="label">Fast</span>
            <h3>Confirmed in seconds</h3>
            <p>
              A tip lands as <code>✓ Confirmed</code> 5-10 seconds after the supporter signs in
              their wallet. No drumming your fingers waiting for ten Bitcoin blocks.
            </p>
          </article>
          <article className="why-card">
            <span className="label">Cheap</span>
            <h3>Fees in fractions of a cent</h3>
            <p>
              A typical Kaspa transaction costs ~0.0001 KAS — pennies, not dollars. A 1 KAS tip
              doesn&apos;t get eaten by network fees.
            </p>
          </article>
          <article className="why-card">
            <span className="label">Yours</span>
            <h3>Secured by proof of work</h3>
            <p>
              Kaspa runs the same proof-of-work consensus model that secures Bitcoin — thousands of
              miners worldwide, no central authority, no premine. KAS is a bearer asset: hold the
              keys, hold the coins.
            </p>
          </article>
        </div>
      </section>

      <section className="card card-muted what-is-kaspa-wallets">
        <h2 style={{ marginBottom: 8 }}>How do I get a Kaspa wallet?</h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          Three solid starting points, depending on where you live with your coins:
        </p>
        <ul className="what-is-kaspa-wallet-list">
          <li>
            <strong>KasWare</strong> — browser extension. Easiest path if you&apos;re paying from a
            desktop, and the one Kaspa Links connects to directly on the pay page.{" "}
            <a href="https://kasware.xyz" rel="noopener noreferrer" target="_blank">
              kasware.xyz →
            </a>
          </li>
          <li>
            <strong>Kaspium</strong> — mobile wallet for iOS and Android. The natural choice if
            you&apos;re tipping from your phone via QR code or shared link.{" "}
            <a href="https://kaspium.io" rel="noopener noreferrer" target="_blank">
              kaspium.io →
            </a>
          </li>
          <li>
            <strong>Tangem</strong> — hardware card. NFC-tap signing, no batteries, no seed-phrase
            paperwork. Right if security is your priority.{" "}
            <a href="https://tangem.com" rel="noopener noreferrer" target="_blank">
              tangem.com →
            </a>
          </li>
        </ul>
        <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
          More options, including hardware wallets and exchanges that list KAS, are listed on{" "}
          <a href="https://kaspa.org" rel="noopener noreferrer" target="_blank">
            kaspa.org →
          </a>
        </p>
      </section>

      <section className="hero" style={{ paddingTop: 12, paddingBottom: 0 }}>
        <p className="hero-sub" style={{ marginBottom: 18 }}>
          Ready to try? Create a link in under two minutes — no email, no signup form.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/create-profile">
            Create a profile
          </Link>
          <Link className="btn" href="/try-it-out">
            See the demo flow
          </Link>
        </div>
      </section>
    </main>
  );
}
