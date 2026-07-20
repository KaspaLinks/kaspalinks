"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SESSION_EVENT } from "../../BrandNav";
import { CreatorSignInGate } from "../../CreatorSignInGate";

const MIN_LINK_COUNT = 1;
const MAX_LINK_COUNT = 10;

function clampCount(value: number): number {
  return Math.min(MAX_LINK_COUNT, Math.max(MIN_LINK_COUNT, Math.trunc(value)));
}

export function ClaimableCreateChooser({ initialCount = 1 }: { initialCount?: number }) {
  const router = useRouter();
  const [count, setCount] = useState(() => clampCount(initialCount));
  const [creatorSignedIn, setCreatorSignedIn] = useState<null | boolean>(null);
  const isClaimDrop = count > 1;

  useEffect(() => {
    const check = () => {
      const token = window.sessionStorage.getItem("kaspa-actions:creator-token") ?? "";
      const username = window.sessionStorage.getItem("kaspa-actions:creator-username") ?? "";
      setCreatorSignedIn(Boolean(token && username));
    };
    check();
    window.addEventListener(SESSION_EVENT, check);
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener(SESSION_EVENT, check);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
    };
  }, []);

  function continueToFlow() {
    router.push(isClaimDrop ? `/claim/batch?count=${count}` : "/claim/create/single");
  }

  if (creatorSignedIn === null) {
    return (
      <main className="main-wide claimable-create-entry">
        <section className="card creator-auth-check">
          <p className="muted">Checking creator session...</p>
        </section>
      </main>
    );
  }

  if (!creatorSignedIn) {
    return (
      <main className="main-wide claimable-create-entry">
        <CreatorSignInGate
          description="A creator profile is required before you configure a Claimable Link or Claim Drop. No email is required."
          label="Claimable rewards"
          nextPath={`/claim/create?count=${count}`}
          title="Sign in to create claimable rewards"
        />
      </main>
    );
  }

  return (
    <main className="main-wide claimable-create-entry">
      <section className="hero claimable-create-entry-hero">
        <span className="hero-eyebrow">Claimable rewards</span>
        <h1 className="hero-title">How many claim links do you need?</h1>
        <p className="hero-sub">
          Create one reward for one recipient, or prepare a Claim Drop with several individual
          links.
        </p>
      </section>

      <section className="card card-accent claimable-count-card">
        <div className="claimable-count-heading">
          <div>
            <span className="label">Number of links</span>
            <h2>{isClaimDrop ? "Create a Claim Drop" : "Create one Claimable Link"}</h2>
          </div>
          <span className="claimable-count-kind">
            {isClaimDrop ? "Claim Drop" : "Single reward"}
          </span>
        </div>

        <div className="claimable-count-stepper" aria-label="Number of claim links" role="group">
          <button
            aria-label="Decrease number of claim links"
            disabled={count === MIN_LINK_COUNT}
            onClick={() => setCount((current) => clampCount(current - 1))}
            type="button"
          >
            −
          </button>
          <output aria-live="polite" className="claimable-count-value">
            <strong>{count}</strong>
          </output>
          <button
            aria-label="Increase number of claim links"
            disabled={count === MAX_LINK_COUNT}
            onClick={() => setCount((current) => clampCount(current + 1))}
            type="button"
          >
            +
          </button>
        </div>

        <div className="claimable-count-summary" aria-live="polite">
          <strong>
            {isClaimDrop
              ? `${count} separate rewards, funded in one batch`
              : "One reward with its own funding address"}
          </strong>
          <p>
            {isClaimDrop
              ? "Each link gets its own on-chain output, private claim code, and refund path. Save the recovery bundle before funding."
              : "The first person with the link can claim the KAS. If it expires unclaimed, your private refund link recovers it."}
          </p>
        </div>

        <button
          className="btn btn-primary claimable-count-continue"
          onClick={continueToFlow}
          type="button"
        >
          Continue with {count} {count === 1 ? "link" : "links"}
        </button>
      </section>

      <p className="claimable-create-entry-note">
        Kaspa Links never holds the funds. Claim and refund transactions remain browser-signed.
      </p>
    </main>
  );
}
