"use client";

import Link from "next/link";
import { useMemo } from "react";

import { CreatorSignInGate } from "../../CreatorSignInGate";
import { MediatedEscrowCreator } from "../../toccata-lab/passkey-signer/MediatedEscrowCreator";
import { useCreatorSession } from "../_lib/use-creator-session";

export function NewEscrowClient() {
  const session = useCreatorSession();
  const creatorHeaders = useMemo(
    () => ({
      "content-type": "application/json",
      "x-creator-token": session.token,
      "x-creator-username": session.username,
    }),
    [session.token, session.username],
  );

  if (!session.hydrated) {
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

  if (!session.signedIn) {
    return (
      <main className="main-wide escrow-layout">
        <CreatorSignInGate
          description="Escrow links use your existing KaspaLinks profile. No extra account and no email."
          label="Escrow link"
          nextPath="/escrow/new"
          title="Sign in to create an escrow link"
        />
      </main>
    );
  }

  return (
    <main className="main-wide escrow-layout passkey-lab">
      <p className="notice notice-warn escrow-prototype-notice" role="note">
        <strong>Private Mainnet canary.</strong> This creates a real SilverScript address and can
        broadcast signed transactions. During testing, send only the exact 0.22 KAS shown by the
        funding step.
      </p>
      <MediatedEscrowCreator creatorHeaders={creatorHeaders} signedIn />
      <section className="card card-muted">
        <p className="muted" style={{ margin: 0 }}>
          <Link href="/escrow">← Back to escrow links</Link>
        </p>
      </section>
    </main>
  );
}
