"use client";

import { useEffect, useState } from "react";

import type { TelegramView } from "./TelegramHome";
import { readApiError, shareInTelegram, telegramAuthHeaders } from "./telegram-mini-app";

type PaymentLink = {
  confirmedCount: number;
  disabled: boolean;
  publicId: string;
  receivedKas: string;
  title: string;
  type: string;
  url: string;
};

type ClaimLink = { amountKas: null | string; linkKey: string; status: string; title: string };

const TYPE_LABELS: Record<string, string> = {
  "kaspa.donation": "Donation",
  "kaspa.goal": "Goal",
  "kaspa.invoice": "Invoice",
  "kaspa.tip": "Tip",
  "kaspa.transfer": "Fixed amount",
};

const CLAIM_STATUS: Record<string, string> = {
  awaiting_funding: "Waiting for your payment",
  claimed: "Claimed",
  funded: "Ready to claim",
  refundable: "Expired · returning",
  refunded: "Returned to you",
  shared: "Ready to claim",
  spent_unknown: "Spent",
};
// Unpaid links can go: their claim code only lived in the Mini App session that
// made them. Finished links can go too. The server checks the address first.
const REMOVABLE_CLAIM_STATUSES = new Set([
  "awaiting_funding",
  "claimed",
  "refunded",
  "spent_unknown",
]);

/** "My links": what this Telegram chat has created, newest first. */
export function TelegramMineApp({ onOpen }: { onOpen(view: TelegramView): void }) {
  const [state, setState] = useState<
    | { kind: "error"; message: string }
    | { claimLinks: ClaimLink[]; kind: "ready"; paymentLinks: PaymentLink[] }
    | { kind: "loading" }
  >({ kind: "loading" });
  const [removing, setRemoving] = useState<null | string>(null);
  const [claimNotice, setClaimNotice] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/telegram/links", { headers: telegramAuthHeaders() });
        if (!response.ok) {
          setState({
            kind: "error",
            message: await readApiError(response, "Your links could not be loaded."),
          });
          return;
        }
        const body = (await response.json()) as {
          claimLinks: ClaimLink[];
          paymentLinks: PaymentLink[];
        };
        setState({ claimLinks: body.claimLinks, kind: "ready", paymentLinks: body.paymentLinks });
      } catch {
        setState({ kind: "error", message: "Network error. Try again." });
      }
    })();
  }, []);

  async function removeClaimLink(linkKey: string) {
    setRemoving(linkKey);
    setClaimNotice("");
    try {
      const response = await fetch(
        `/api/creator/claimable-links?linkKey=${encodeURIComponent(linkKey)}`,
        { headers: telegramAuthHeaders(), method: "DELETE" },
      );
      if (!response.ok) {
        setClaimNotice(await readApiError(response, "This link could not be removed."));
        return;
      }
      setState((current) =>
        current.kind === "ready"
          ? {
              ...current,
              claimLinks: current.claimLinks.filter((link) => link.linkKey !== linkKey),
            }
          : current,
      );
    } catch {
      setClaimNotice("Network error. Try again.");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <main className="main telegram-claim-page">
      <header className="telegram-claim-head">
        <span className="label">Kaspa Links</span>
        <h1 className="form-section-heading">My links</h1>
      </header>

      {state.kind === "loading" ? <p className="muted">Loading…</p> : null}
      {state.kind === "error" ? <p className="error-text">{state.message}</p> : null}

      {state.kind === "ready" ? (
        <>
          <section className="card account-free-panel">
            <span className="label">Payment links</span>
            {state.paymentLinks.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              <ul className="account-free-list">
                {state.paymentLinks.map((link) => (
                  <li key={link.publicId}>
                    <div>
                      <strong>{link.title}</strong>
                      <span className="muted">
                        {TYPE_LABELS[link.type] ?? "Payment link"} ·{" "}
                        {link.confirmedCount === 0
                          ? "no payments yet"
                          : `${link.receivedKas} KAS from ${link.confirmedCount}`}
                        {link.disabled ? " · paused" : ""}
                      </span>
                    </div>
                    <button
                      className="btn btn-sm"
                      onClick={() => shareInTelegram(link.url, link.title)}
                      type="button"
                    >
                      Share
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button className="btn" onClick={() => onOpen("pay")} type="button">
              New payment link
            </button>
          </section>

          <section className="card account-free-panel">
            <span className="label">Claim links</span>
            {state.claimLinks.length === 0 ? (
              <p className="muted">None yet.</p>
            ) : (
              <ul className="account-free-list">
                {state.claimLinks.map((link) => (
                  <li key={link.linkKey}>
                    <div>
                      <strong>{link.title}</strong>
                      <span className="muted">
                        {link.amountKas ? `${link.amountKas} KAS · ` : ""}
                        {CLAIM_STATUS[link.status] ?? link.status}
                      </span>
                    </div>
                    {REMOVABLE_CLAIM_STATUSES.has(link.status) ? (
                      <button
                        className="btn btn-sm"
                        disabled={removing !== null}
                        onClick={() => void removeClaimLink(link.linkKey)}
                        type="button"
                      >
                        {removing === link.linkKey ? "Removing…" : "Remove"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {claimNotice ? <p className="error-text">{claimNotice}</p> : null}
            <p className="muted">
              The secret claim link stays on the phone that made it. The bot tells you when a link
              is claimed or returned. A link that was never paid cannot be paid later; remove it and
              create a new one.
            </p>
            <button className="btn" onClick={() => onOpen("claim")} type="button">
              New claim link
            </button>
          </section>

          <section className="card account-free-panel">
            <span className="label">Giveaways</span>
            <button className="btn" onClick={() => onOpen("manage")} type="button">
              Manage giveaways
            </button>
          </section>
        </>
      ) : null}
    </main>
  );
}
