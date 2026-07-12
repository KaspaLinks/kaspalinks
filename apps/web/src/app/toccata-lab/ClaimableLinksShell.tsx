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
            <h1 className="hero-title">You&rsquo;ve got Kaspa to claim.</h1>
            <p className="hero-sub">
              Someone created a claimable Kaspa link for you. Enter your wallet address below and
              the KAS is sent straight to you — non-custodial, no account needed.
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
              Create a claimable link, fund its one-time address, then share it. The recipient
              claims the KAS to their own wallet — or you refund it if it is never claimed. Claim
              and refund codes stay in your browser, never on our servers.
            </p>
          </>
        )}
      </section>

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
