"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { GrowthPrompt } from "@/app/GrowthPrompt";
import { SuccessHero } from "@/app/SuccessHero";
import { TurnstileWidget } from "@/app/toccata-lab/giveaway/[publicId]/TurnstileWidget";
import { GIVEAWAY_TURNSTILE_ACTION } from "@/lib/turnstile-shared";
import { kaspaStreamTransactionUrl } from "@/lib/kaspa-stream";

type Submission = {
  commitmentHex: string;
  shardIndex: number;
  status: "SUBMITTED";
  transactionId: string;
};

const MAX_AUTO_RETRIES = 3;
const AUTO_RETRY_DELAY_MS = 6_000;

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
  // A busy shard (someone else joined a moment earlier) is retried by itself,
  // once a fresh human-check token is there.
  const [retry, setRetry] = useState<null | { attempt: number; notBefore: number }>(null);

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

  useEffect(() => {
    if (!retry || !token || busy || submission) return;
    const timer = window.setTimeout(
      () => void submitEntry(retry.attempt),
      Math.max(0, retry.notBefore - Date.now()),
    );
    return () => window.clearTimeout(timer);
    // submitEntry reads the current address and token of this render.
  }, [busy, retry, submission, token]);

  async function submitEntry(attempt: number) {
    if (busy || !token || !address.trim()) return;
    setBusy(true);
    if (attempt === 0) setMessage("");
    try {
      const response = await fetch(`/api/giveaways/${encodeURIComponent(publicId)}/entries`, {
        body: JSON.stringify({ address, turnstileToken: token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const data = (await response.json()) as {
        error?: { code?: string; message?: string };
        registration?: Submission;
      };
      if (response.ok && data.registration) {
        setRetry(null);
        setMessage("");
        setSubmission(data.registration);
        return;
      }
      if (data.error?.code === "ENTRY_BUSY" && attempt < MAX_AUTO_RETRIES) {
        setRetry({ attempt: attempt + 1, notBefore: Date.now() + AUTO_RETRY_DELAY_MS });
        setMessage("Many people are joining right now. Trying again in a few seconds…");
        return;
      }
      setRetry(null);
      throw new Error(data.error?.message ?? "Registration failed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registration failed.");
    } finally {
      setBusy(false);
      setToken(null);
      setReset((value) => value + 1);
    }
  }

  if (submission) {
    const explorerUrl =
      network === "mainnet" ? (kaspaStreamTransactionUrl(submission.transactionId) ?? null) : null;
    if (chainStatus === "confirmed") {
      return (
        <>
          <SuccessHero title="You're in!">
            <p>
              Your entry is confirmed on Kaspa. If you win, the prize goes straight to your address
              after the draw.
            </p>
            {explorerUrl ? (
              <a href={explorerUrl} target="_blank" rel="noreferrer">
                View your entry
              </a>
            ) : null}
          </SuccessHero>
          {network === "mainnet" ? <GrowthPrompt source="giveaway-entry" /> : null}
        </>
      );
    }
    return (
      <div className="giveaway-entry-success giveaway-v6-entry-success" role="status">
        <span>{chainStatus === "late" ? "!" : "…"}</span>
        <div>
          <strong>
            {chainStatus === "late" ? "Entry confirmed after closing" : "Entry sent to Kaspa"}
          </strong>
          <p>
            {chainStatus === "late"
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
      onSubmit={(event) => {
        event.preventDefault();
        setRetry(null);
        void submitEntry(0);
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
      <button
        className="btn btn-primary"
        disabled={busy || retry !== null || !token || !address.trim()}
      >
        {busy || retry !== null ? "Sending entry…" : "Join giveaway"}
      </button>
      <small className="muted">
        No account or wallet connection required. Your address is committed on-chain.
      </small>
    </form>
  );
}
