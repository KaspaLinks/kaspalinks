"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TurnstileWidget } from "@/app/toccata-lab/giveaway/[publicId]/TurnstileWidget";
import { GIVEAWAY_TURNSTILE_ACTION } from "@/lib/turnstile-shared";
export default function EntryClient({
  id,
  available,
  siteKey,
}: {
  id: string;
  available: boolean;
  siteKey: string;
}) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [entered, setEntered] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !busy) router.refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [router, busy]);
  return (
    <>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {entered ? (
        <div className="giveaway-entry-success" role="status">
          <strong>✓ You’re in!</strong>
          <p>Keep this link to see the winner.</p>
        </div>
      ) : available ? (
        <form
          className="giveaway-entry-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !token) return;
            setBusy(true);
            setMessage("");
            try {
              const response = await fetch(`/api/giveaways/${id}/entries`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ address, turnstileToken: token }),
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error?.message ?? "Registration failed.");
              setEntered(true);
              router.refresh();
            } catch (e) {
              setMessage(e instanceof Error ? e.message : "Registration failed.");
            } finally {
              setBusy(false);
              setToken(null);
              setReset((v) => v + 1);
            }
          }}
        >
          <label htmlFor="payout-address">Your Kaspa payout address</label>
          <input
            id="payout-address"
            required
            maxLength={150}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="kaspa:…"
            autoCapitalize="none"
            spellCheck={false}
            style={{ width: "100%" }}
            disabled={busy}
          />
          <p className="muted">Winnings go directly to this address.</p>
          <TurnstileWidget
            siteKey={siteKey}
            action={GIVEAWAY_TURNSTILE_ACTION}
            resetKey={reset}
            onToken={setToken}
            onError={() => setMessage("Human verification failed. Please retry.")}
          />
          <button className="btn btn-primary" disabled={busy || !token || !address.trim()}>
            {busy ? "Entering…" : "Enter giveaway"}
          </button>
        </form>
      ) : null}
      <button className="btn btn-small" onClick={() => router.refresh()} disabled={busy}>
        Refresh status
      </button>
    </>
  );
}
