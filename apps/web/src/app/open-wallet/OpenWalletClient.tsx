"use client";

import { useEffect, useState } from "react";

import { BrandLogo } from "../BrandLogo";
import { writeClipboardText } from "@/lib/clipboard";
import { parseWalletLaunchUri } from "@/lib/wallet-uri";

type WalletRequest = NonNullable<ReturnType<typeof parseWalletLaunchUri>>;

// The Telegram Mini App sends wallet payments here: the phone's browser can hand a
// kaspa: link to Kaspium or another wallet app, the Mini App view cannot.
export function OpenWalletClient() {
  const [request, setRequest] = useState<null | undefined | WalletRequest>(undefined);
  const [copied, setCopied] = useState<"" | "address" | "amount">("");

  useEffect(() => {
    const read = () => {
      let uri = "";
      try {
        uri = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        // A malformed fragment is treated like a missing one.
      }
      const parsed = parseWalletLaunchUri(uri);
      setRequest(parsed);
      setCopied("");
      // The tap in Telegram already asked for the wallet; the button below stays as a fallback.
      if (parsed) window.location.assign(parsed.uri);
    };
    read();
    // A tab that is already open only sees the fragment change.
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  async function copy(kind: "address" | "amount", value: string) {
    if (await writeClipboardText(value)) setCopied(kind);
  }

  return (
    <main className="not-found-page">
      <section className="not-found-panel">
        <BrandLogo variant="hero" />
        {request === undefined ? (
          <p className="muted">Opening your wallet…</p>
        ) : request === null ? (
          <>
            <h1>Nothing to pay here.</h1>
            <p className="muted">
              This wallet link is incomplete. Go back to Telegram and tap Open in wallet again.
            </p>
          </>
        ) : (
          <>
            <span className="hero-eyebrow">Pay from your wallet</span>
            <h1>{request.amountKas ? `Send exactly ${request.amountKas} KAS` : "Send KAS"}</h1>
            <p className="muted">
              Your wallet app should open now. If it does not, tap Open in wallet. After sending,
              switch back to Telegram.
            </p>
            <code className="batch-lab-address">{request.address}</code>
            <div className="row">
              <a className="btn btn-primary" href={request.uri}>
                Open in wallet
              </a>
              <button
                className="btn"
                onClick={() => void copy("address", request.address)}
                type="button"
              >
                {copied === "address" ? "Address copied" : "Copy address"}
              </button>
              {request.amountKas ? (
                <button
                  className="btn"
                  onClick={() => void copy("amount", request.amountKas ?? "")}
                  type="button"
                >
                  {copied === "amount" ? "Amount copied" : "Copy amount"}
                </button>
              ) : null}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
