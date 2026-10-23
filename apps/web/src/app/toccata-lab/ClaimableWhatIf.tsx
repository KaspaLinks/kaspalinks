const DOCS_URL = "https://github.com/KaspaLinks/kaspalinks/blob/main/docs/claimable-links.md";

/**
 * The remaining risks of an auto-return claim link, answered before any KAS
 * moves. Mirrors the "What if…" section of docs/claimable-links.md.
 */
export function ClaimableWhatIf({ kind }: { kind: "drop" | "link" }) {
  const links = kind === "drop";
  return (
    <details className="batch-drop-options claimable-what-if">
      <summary>What if…?</summary>
      <dl>
        <div>
          <dt>{links ? "A link reaches the wrong person" : "The link reaches the wrong person"}</dt>
          <dd>
            A claim link works like cash: whoever opens the full link first can claim it. Send{" "}
            {links ? "each one" : "it"} only to the person it is for.
          </dd>
        </div>
        <div>
          <dt>Nobody claims {links ? "a link" : "it"}</dt>
          <dd>
            After the claim window the KAS can only go back to your wallet. Kaspa Links sends it
            back within a few minutes, and anyone can press Return now on the link page.
          </dd>
        </div>
        <div>
          <dt>Kaspa Links is offline</dt>
          <dd>
            The KAS stays locked on-chain and nobody can move it anywhere else. Claims and the
            return go out once the service is back.
          </dd>
        </div>
        <div>
          <dt>You send a different amount</dt>
          <dd>
            {links ? "The drop" : "The link"} stays locked. Every payment to the address comes back
            to your wallet after the claim window.
          </dd>
        </div>
      </dl>
      <a href={DOCS_URL} rel="noreferrer" target="_blank">
        How the return works
      </a>
    </details>
  );
}
