"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { TurnstileWidget } from "@/app/toccata-lab/giveaway/[publicId]/TurnstileWidget";
import { GIVEAWAY_TURNSTILE_ACTION } from "@/lib/turnstile-shared";

type Submission = {
  commitmentHex: string;
  shardIndex: number;
  status: "SUBMITTED";
  transactionId: string;
};

const VERIFICATION_RETRYING =
  "Human verification did not finish yet. It retries on its own; the button unlocks when it passes.";

export default function V6EntryClient({
  available,
  network,
  publicId,
  siteKey,
}: {
  available: boolean;
  network: "mainnet" | "testnet-10";
  publicId: string;
  siteKey: string;
}) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [chainStatus, setChainStatus] = useState<"pending" | "confirmed" | "late">("pending");

  useEffect(() => {
    if (!submission || chainStatus !== "pending") return;
    let disposed = false;
    const check = async () => {
      try {
        const response = await fetch(
          `/api/giveaways/${encodeURIComponent(publicId)}/verification`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const data = (await response.json()) as {
          protocol?: { config?: { closesAtDaa?: string } };
          projection?: {
            transitions?: Array<{
              event?: { blockDaaScore?: string; transactionId?: string };
            }>;
          };
        };
        const transition = data.projection?.transitions?.find(
          (transition) => transition.event?.transactionId === submission.transactionId,
        );
        if (transition?.event?.blockDaaScore && !disposed) {
          const closesAtDaa = data.protocol?.config?.closesAtDaa;
          setChainStatus(
            closesAtDaa && BigInt(transition.event.blockDaaScore) > BigInt(closesAtDaa)
              ? "late"
              : "confirmed",
          );
          router.refresh();
        }
      } catch {
        // Keep the submitted transaction visible and retry while this page is open.
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 5_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [chainStatus, publicId, router, submission]);

  if (submission) {
    const explorerUrl =
      network === "mainnet"
        ? `https://explorer.kaspa.org/txs/${submission.transactionId}`
        : null;
    return (
      <div className="giveaway-entry-success giveaway-v6-entry-success" role="status">
        <span>{chainStatus === "confirmed" ? "✓" : chainStatus === "late" ? "!" : "…"}</span>
        <div>
          <strong>
            {chainStatus === "confirmed"
              ? "Entry confirmed on Kaspa"
              : chainStatus === "late"
                ? "Entry confirmed after closing"
                : "Entry sent to Kaspa"}
          </strong>
          <p>
            {chainStatus === "confirmed"
              ? "Your payout address is now part of the eligible on-chain participant set."
              : chainStatus === "late"
                ? "Kaspa confirmed this transaction too late for the draw, so it is not eligible."
                : "Confirmation normally takes a few seconds. Keep this page open to see it update."}
          </p>
          <code>{submission.transactionId}</code>
          {explorerUrl ? (
            <a href={explorerUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  if (!available) {
    return (
      <div className="giveaway-result-state">
        <p>Entry is temporarily unavailable while on-chain verification catches up.</p>
      </div>
    );
  }

  return (
    <form
      className="giveaway-entry-form giveaway-v6-entry-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !token || !address.trim()) return;
        setBusy(true);
        setMessage("");
        try {
          const response = await fetch(`/api/giveaways/${encodeURIComponent(publicId)}/entries`, {
            body: JSON.stringify({ address, turnstileToken: token }),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          const data = (await response.json()) as {
            error?: { message?: string };
            registration?: Submission;
          };
          if (!response.ok || !data.registration) {
            throw new Error(data.error?.message ?? "Registration failed.");
          }
          setSubmission(data.registration);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Registration failed.");
        } finally {
          setBusy(false);
          setToken(null);
          setReset((value) => value + 1);
        }
      }}
    >
      <div>
        <span className="label">Join for free</span>
        <h2>Where should the prize go?</h2>
        <p className="muted">Enter any Kaspa Mainnet address you control.</p>
      </div>
      <label htmlFor="v6-payout-address">Kaspa payout address</label>
      <input
        id="v6-payout-address"
        required
        maxLength={150}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        placeholder="kaspa:…"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
      />
      <TurnstileWidget
        siteKey={siteKey}
        action={GIVEAWAY_TURNSTILE_ACTION}
        resetKey={reset}
        onToken={(value) => {
          setToken(value);
          // Turnstile retries on its own; once it passes, the earlier notice is stale.
          if (value) setMessage((current) => (current === VERIFICATION_RETRYING ? "" : current));
        }}
        onError={() => setMessage(VERIFICATION_RETRYING)}
      />
      {message ? (
        <p className="form-error" role="alert">
          {message}
        </p>
      ) : null}
      <button className="btn btn-primary" disabled={busy || !token || !address.trim()}>
        {busy ? "Sending entry…" : "Join giveaway"}
      </button>
      <small className="muted">
        No account or wallet connection required. Your address is committed on-chain.
      </small>
    </form>
  );
}
