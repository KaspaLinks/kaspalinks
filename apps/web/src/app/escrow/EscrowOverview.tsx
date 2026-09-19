"use client";

import Link from "next/link";

import { EscrowIntro } from "./_components/EscrowIntro";
import { LockIcon } from "./_components/EscrowIcons";
import { EscrowPrototypeNotice } from "./_components/EscrowPrototypeNotice";
import { EscrowRules } from "./_components/EscrowRules";
import { MyEscrowLinks } from "./MyEscrowLinks";

export function EscrowOverview() {
  return (
    <main className="main-wide escrow-layout">
      <EscrowPrototypeNotice />

      <section className="hero escrow-hero">
        <span className="hero-eyebrow">Kaspa escrow links</span>
        <h1 className="hero-title">Buy &amp; sell with Kaspa escrow.</h1>
        <p className="hero-sub">
          Agree on a deal wherever you already trade. Share one link. The KAS stay locked on Kaspa
          until you are both done.
        </p>
        <div className="row escrow-hero-actions">
          <Link className="btn btn-primary" href="/escrow/new">
            Create escrow link
          </Link>
          <Link className="btn" href="#how-it-works">
            How it works
          </Link>
          <Link className="btn" href="/toccata-lab/passkey-signer">
            Test passkey signer
          </Link>
        </div>
        <p className="escrow-hero-trust">
          <LockIcon />
          <span>Non-custodial. KaspaLinks never holds your KAS or keys.</span>
        </p>
      </section>

      <MyEscrowLinks />

      <EscrowIntro />

      <section aria-labelledby="escrow-rules-heading" className="card">
        <span className="label">The rules</span>
        <h2 id="escrow-rules-heading">What the escrow does, and what it doesn’t</h2>
        <EscrowRules releaseWindowDays={null} />
      </section>
    </main>
  );
}
