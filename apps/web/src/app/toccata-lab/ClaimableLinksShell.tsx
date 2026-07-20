import Link from "next/link";

import {
  ToccataLabClient,
  type ClaimableLinksInitialMode,
  type PublicClaimableLinkMetadata,
} from "./ToccataLabClient";

import {
  getToccataLabCapabilityNames,
  isToccataLabEnabled,
  readToccataLabCapabilities,
} from "@/lib/toccata-lab";

type ClaimableLinksShellProps = {
  initialPublicLink?: PublicClaimableLinkMetadata | null;
  mode: ClaimableLinksInitialMode;
};

export async function ClaimableLinksShell({
  initialPublicLink = null,
  mode,
}: ClaimableLinksShellProps) {
  const enabled = isToccataLabEnabled();
  let capabilities;
  try {
    capabilities = readToccataLabCapabilities();
  } catch (error) {
    capabilities = {
      missing: [(error as Error).message],
      ready: false,
      version: "unknown",
    };
  }

  return (
    <main className="main-wide toccata-lab-page">
      <section className="hero toccata-lab-hero">
        {mode === "claim" ? (
          <>
            <span className="hero-eyebrow">Kaspa Links</span>
            <h1 className="hero-title">Claim a Kaspa link.</h1>
            <p className="hero-sub">
              Open the complete private link or enter its fallback claim code, then send the KAS
              straight to your own wallet — non-custodial, no account needed.
            </p>
          </>
        ) : mode === "manage" ? (
          <>
            <span className="hero-eyebrow">Kaspa Links</span>
            <h1 className="hero-title">Refund an unclaimed link.</h1>
            <p className="hero-sub">
              Use your private refund link after the claim window expires. Refund and claim codes
              stay in your browser, never on our servers.
            </p>
          </>
        ) : (
          <>
            <span className="hero-eyebrow">Kaspa Links</span>
            <h1 className="hero-title">Create a claimable Kaspa link.</h1>
            <p className="hero-sub">
              Set the reward and expiry, fund its one-time address, then share. The recipient claims
              it directly, or you refund it after expiry.
            </p>
          </>
        )}
      </section>

      {mode === "create" ? (
        <p className="hero-newcomer-link">
          Need several rewards? <Link href="/claim/create?count=2">Create a Claim Drop →</Link>
        </p>
      ) : null}

      <ToccataLabClient
        capabilities={capabilities}
        enabled={enabled}
        initialMode={mode}
        initialPublicLink={initialPublicLink}
        requiredCapabilities={getToccataLabCapabilityNames()}
      />
    </main>
  );
}
