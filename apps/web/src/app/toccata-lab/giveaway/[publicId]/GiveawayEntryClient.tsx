"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type PublicGiveaway = {
  amountKas: string;
  closesAt: string;
  description: null | string;
  drawCommitment: string;
  drawProof: null | {
    digest: null | string;
    entryCount: null | number;
    entryHashes: string[];
    seed: string;
    winnerIndex: null | number;
  };
  entryCount: number;
  publicId: string;
  status: "CANCELLED" | "CLOSED" | "DRAWN" | "NO_ENTRIES" | "OPEN";
  title: string;
  winnerAddress: null | string;
};

export function GiveawayEntryClient({ publicId }: { publicId: string }) {
  const [giveaway, setGiveaway] = useState<null | PublicGiveaway>(null);
  const [address, setAddress] = useState("");
  const [entryHash, setEntryHash] = useState<null | string>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [now, setNow] = useState(() => Date.now());
  const finalizeInFlight = useRef(false);

  const loadGiveaway = useCallback(async () => {
    try {
      const response = await fetch(`/api/toccata-lab/giveaways/${encodeURIComponent(publicId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        giveaway?: PublicGiveaway;
      };
      if (!response.ok || !body.giveaway)
        throw new Error(body.error?.message ?? "Giveaway could not be loaded.");
      setGiveaway(body.giveaway);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giveaway could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [publicId]);

  useEffect(() => {
    void loadGiveaway();
  }, [loadGiveaway]);

  const finalizeGiveaway = useCallback(async () => {
    if (finalizeInFlight.current) return;
    finalizeInFlight.current = true;
    setFinalizing(true);
    try {
      const response = await fetch(
        `/api/toccata-lab/giveaways/${encodeURIComponent(publicId)}/draw`,
        { method: "POST" },
      );
      if (!response.ok && response.status !== 409) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Giveaway draw could not be completed.");
      }
      await loadGiveaway();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giveaway draw could not be completed.");
    } finally {
      finalizeInFlight.current = false;
      setFinalizing(false);
    }
  }, [loadGiveaway, publicId]);

  useEffect(() => {
    if (
      !giveaway ||
      giveaway.status === "DRAWN" ||
      giveaway.status === "NO_ENTRIES" ||
      giveaway.status === "CANCELLED"
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (giveaway.status === "CLOSED") {
        void finalizeGiveaway();
      } else if (
        giveaway.status !== "OPEN" ||
        new Date(giveaway.closesAt).getTime() <= Date.now()
      ) {
        void loadGiveaway();
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [finalizeGiveaway, giveaway, loadGiveaway]);

  useEffect(() => {
    if (giveaway?.status === "CLOSED") void finalizeGiveaway();
  }, [finalizeGiveaway, giveaway?.status]);

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/toccata-lab/giveaways/${encodeURIComponent(publicId)}/entries`,
        {
          body: JSON.stringify({ address }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = (await response.json()) as {
        entry?: { entryHash: string };
        entryCount?: number;
        error?: { message?: string };
      };
      if (!response.ok || !body.entry)
        throw new Error(body.error?.message ?? "Entry could not be submitted.");
      setEntryHash(body.entry.entryHash);
      setGiveaway((current) =>
        current ? { ...current, entryCount: body.entryCount ?? current.entryCount + 1 } : current,
      );
      window.localStorage.setItem(`kaspa-links:giveaway-entry:${publicId}`, body.entry.entryHash);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Entry could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    setEntryHash(window.localStorage.getItem(`kaspa-links:giveaway-entry:${publicId}`));
  }, [publicId]);

  if (loading)
    return (
      <main className="main giveaway-entry-page">
        <p>Loading giveaway…</p>
      </main>
    );
  if (!giveaway)
    return (
      <main className="main giveaway-entry-page">
        <div className="notice notice-error">{error ?? "Giveaway not found."}</div>
      </main>
    );

  const status =
    giveaway.status === "OPEN" && new Date(giveaway.closesAt).getTime() <= now
      ? "CLOSED"
      : giveaway.status;
  const isWinner = Boolean(
    entryHash &&
    giveaway.drawProof?.entryHashes[giveaway.drawProof.winnerIndex ?? -1] === entryHash,
  );

  return (
    <main className="main giveaway-entry-page">
      <section className="giveaway-entry-hero">
        <span className="hero-eyebrow">Giveaway Lab</span>
        <h1>{giveaway.title}</h1>
        {giveaway.description ? <p>{giveaway.description}</p> : null}
        <strong>{giveaway.amountKas} KAS</strong>
      </section>

      <section className="card giveaway-entry-card">
        {status === "OPEN" ? (
          <>
            <div className="giveaway-entry-status">
              <span>Entries close in</span>
              <strong>{countdown(giveaway.closesAt, now)}</strong>
            </div>
            {entryHash ? (
              <div className="giveaway-entry-success" role="status">
                <span aria-hidden="true">✓</span>
                <div>
                  <h2>You are entered</h2>
                  <p>Keep this page or entry receipt open to check the draw result.</p>
                </div>
              </div>
            ) : (
              <form className="giveaway-entry-form" onSubmit={enter}>
                <label className="field">
                  <span className="label">Your mainnet Kaspa address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="kaspa:…"
                    required
                    value={address}
                  />
                </label>
                <button className="btn btn-primary" disabled={submitting} type="submit">
                  {submitting ? "Entering…" : "Enter giveaway"}
                </button>
              </form>
            )}
          </>
        ) : status === "CLOSED" ? (
          <div className="giveaway-result-state">
            <span className="label">Entries closed</span>
            <h2>{finalizing ? "Drawing the winner…" : "Finalizing the draw"}</h2>
            <p>The one-time draw starts automatically.</p>
          </div>
        ) : status === "DRAWN" ? (
          <div className={`giveaway-result-state${isWinner ? " is-winner" : ""}`}>
            <span className="label">Draw complete</span>
            <h2>{isWinner ? "You won" : "A winner was selected"}</h2>
            <p>Winning address</p>
            <code>{giveaway.winnerAddress}</code>
            {isWinner ? (
              <p>
                The creator still needs to send the KAS from their wallet. Kaspa Links never holds
                the prize.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="giveaway-result-state">
            <span className="label">Closed</span>
            <h2>{status === "NO_ENTRIES" ? "No entries" : "Giveaway cancelled"}</h2>
          </div>
        )}

        {error ? (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="giveaway-entry-meta">
          <span>
            {giveaway.entryCount} {giveaway.entryCount === 1 ? "entry" : "entries"}
          </span>
          <span>
            Draw commitment <code>{compactHash(giveaway.drawCommitment)}</code>
          </span>
        </div>
        {entryHash ? (
          <details className="giveaway-proof">
            <summary>Your entry receipt</summary>
            <code>{entryHash}</code>
          </details>
        ) : null}
        {giveaway.drawProof ? (
          <details className="giveaway-proof">
            <summary>Auditable draw proof</summary>
            <dl>
              <dt>Seed</dt>
              <dd>
                <code>{giveaway.drawProof.seed}</code>
              </dd>
              <dt>Digest</dt>
              <dd>
                <code>{giveaway.drawProof.digest}</code>
              </dd>
              <dt>Selected index</dt>
              <dd>{giveaway.drawProof.winnerIndex ?? "—"}</dd>
            </dl>
          </details>
        ) : null}
      </section>

      <p className="giveaway-entry-footnote">
        One entry per Kaspa address. Addresses are checked for format, not wallet ownership. No
        funds are held by Kaspa Links.
      </p>
    </main>
  );
}

function countdown(value: string, now: number): string {
  const totalSeconds = Math.max(0, Math.ceil((new Date(value).getTime() - now) / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
