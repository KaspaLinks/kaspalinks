"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { CreatorSignInGate } from "@/app/CreatorSignInGate";
import { buildWalletLaunchUri } from "@/lib/wallet-uri";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";

type GiveawayStatus = "CANCELLED" | "CLOSED" | "DRAWN" | "NO_ENTRIES" | "OPEN";

type GiveawaySummary = {
  amountKas: string;
  closesAt: string;
  createdAt?: string;
  description: null | string;
  drawCommitment: string;
  drawProof: null | {
    digest: null | string;
    entryCount: null | number;
    seed: string;
    winnerIndex: null | number;
  };
  entryCount: number;
  publicId: string;
  publicUrl: string;
  status: GiveawayStatus;
  title: string;
  winnerAddress: null | string;
};

type Session = { token: string; username: string };

export function GiveawayLabClient({ enabled }: { enabled: boolean }) {
  const [session, setSession] = useState<null | Session>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [giveaways, setGiveaways] = useState<GiveawaySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [drawingId, setDrawingId] = useState<null | string>(null);
  const [error, setError] = useState<null | string>(null);
  const [notice, setNotice] = useState<null | string>(null);
  const [now, setNow] = useState(() => Date.now());
  const [title, setTitle] = useState("Weekend KAS giveaway");
  const [description, setDescription] = useState("Enter your Kaspa address for a chance to win.");
  const [amountKas, setAmountKas] = useState("10");
  const [durationValue, setDurationValue] = useState("15");
  const [durationUnit, setDurationUnit] = useState<"days" | "hours" | "minutes">("minutes");
  const [qrById, setQrById] = useState<Record<string, string>>({});

  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
    const username = window.sessionStorage.getItem(USERNAME_STORAGE_KEY)?.trim() ?? "";
    setSession(token && username ? { token, username } : null);
    setSessionReady(true);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const creatorHeaders = useMemo(
    () =>
      session
        ? {
            "Content-Type": "application/json",
            "x-creator-token": session.token,
            "x-creator-username": session.username,
          }
        : null,
    [session],
  );

  const loadGiveaways = useCallback(async () => {
    if (!creatorHeaders) return;
    setLoading(true);
    try {
      const response = await fetch("/api/toccata-lab/giveaways", {
        cache: "no-store",
        headers: creatorHeaders,
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        giveaways?: GiveawaySummary[];
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Giveaways could not be loaded.");
      setGiveaways(body.giveaways ?? []);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giveaways could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [creatorHeaders]);

  useEffect(() => {
    void loadGiveaways();
  }, [loadGiveaways]);

  async function createGiveaway(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!creatorHeaders) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const duration = Number(durationValue);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Enter a valid duration.");
      const unitMs =
        durationUnit === "days" ? 86_400_000 : durationUnit === "hours" ? 3_600_000 : 60_000;
      const closesAt = new Date(Date.now() + duration * unitMs).toISOString();
      const response = await fetch("/api/toccata-lab/giveaways", {
        body: JSON.stringify({ amountKas, closesAt, description, title }),
        headers: creatorHeaders,
        method: "POST",
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        giveaway?: GiveawaySummary;
      };
      if (!response.ok || !body.giveaway) {
        throw new Error(body.error?.message ?? "Giveaway could not be created.");
      }
      setGiveaways((current) => [body.giveaway!, ...current]);
      setNotice("Giveaway created. Share the entry link when you are ready.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giveaway could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  async function drawWinner(publicId: string) {
    if (!creatorHeaders) return;
    setDrawingId(publicId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/toccata-lab/giveaways/${publicId}/draw`, {
        headers: creatorHeaders,
        method: "POST",
      });
      const body = (await response.json()) as {
        error?: { message?: string };
        giveaway?: {
          drawProof: GiveawaySummary["drawProof"];
          status: GiveawayStatus;
          winnerAddress: null | string;
        };
      };
      if (!response.ok || !body.giveaway) {
        throw new Error(body.error?.message ?? "Winner could not be drawn.");
      }
      setGiveaways((current) =>
        current.map((giveaway) =>
          giveaway.publicId === publicId
            ? {
                ...giveaway,
                drawProof: body.giveaway!.drawProof,
                status: body.giveaway!.status,
                winnerAddress: body.giveaway!.winnerAddress,
              }
            : giveaway,
        ),
      );
      setNotice(
        body.giveaway.status === "DRAWN"
          ? "Winner drawn. Review the address before paying from your wallet."
          : "Giveaway closed without entries.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Winner could not be drawn.");
    } finally {
      setDrawingId(null);
    }
  }

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setError("Clipboard access failed. Select and copy the value manually.");
    }
  }

  async function showPayoutQr(giveaway: GiveawaySummary) {
    if (!giveaway.winnerAddress) return;
    try {
      const QRCode = await import("qrcode");
      const uri = buildWalletLaunchUri({
        amountKas: giveaway.amountKas,
        recipientAddress: giveaway.winnerAddress,
      });
      const dataUrl = await QRCode.toDataURL(uri, {
        color: { dark: "#0b1116", light: "#ffffff" },
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
      });
      setQrById((current) => ({ ...current, [giveaway.publicId]: dataUrl }));
    } catch {
      setError("Payout QR code could not be generated.");
    }
  }

  if (!enabled) {
    return (
      <main className="main giveaway-lab-page">
        <section className="card">
          <h1>Giveaway Lab is disabled</h1>
          <p className="muted">This private experiment is not enabled on this deployment.</p>
        </section>
      </main>
    );
  }

  if (!sessionReady)
    return (
      <main className="main giveaway-lab-page">
        <p>Loading…</p>
      </main>
    );
  if (!session) {
    return (
      <main className="main giveaway-lab-page">
        <CreatorSignInGate
          description="Sign in with your creator token to create and draw private Lab giveaways."
          label="Private Lab"
          nextPath="/toccata-lab/giveaway"
          title="Creator sign-in required"
        />
      </main>
    );
  }

  return (
    <main className="main-wide giveaway-lab-page">
      <section className="hero giveaway-lab-hero">
        <span className="hero-eyebrow">Private Lab</span>
        <h1 className="hero-title">Address giveaway.</h1>
        <p className="hero-sub">
          Collect mainnet addresses, close entries at a fixed time, and draw one auditable winner.
          You pay the winner directly from your own wallet.
        </p>
      </section>

      <section className="giveaway-lab-safety" aria-label="Non-custodial model">
        <strong>No funds or wallet keys are stored.</strong>
        <span>
          The draw selects an address only. Payout remains an explicit wallet payment. One address
          can enter once, but this Lab does not prove that different addresses belong to different
          people.
        </span>
      </section>

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="notice notice-success" role="status">
          {notice}
        </div>
      ) : null}

      <section className="card giveaway-create-card">
        <div className="section-heading">
          <div>
            <span className="label">Create</span>
            <h2>New giveaway</h2>
          </div>
        </div>
        <form className="giveaway-form" onSubmit={createGiveaway}>
          <label className="field">
            <span className="label">Title</span>
            <input
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label className="field">
            <span className="label">Description</span>
            <textarea
              maxLength={280}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              value={description}
            />
          </label>
          <div className="giveaway-form-grid">
            <label className="field">
              <span className="label">Reward in KAS</span>
              <input
                inputMode="decimal"
                onChange={(event) => setAmountKas(event.target.value.replace(",", "."))}
                required
                value={amountKas}
              />
            </label>
            <div className="field">
              <span className="label">Entry window</span>
              <div className="giveaway-duration-control">
                <input
                  inputMode="numeric"
                  min="1"
                  onChange={(event) => setDurationValue(event.target.value)}
                  required
                  type="number"
                  value={durationValue}
                />
                <select
                  onChange={(event) => setDurationUnit(event.target.value as typeof durationUnit)}
                  value={durationUnit}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </div>
          </div>
          <button className="btn btn-primary" disabled={submitting} type="submit">
            {submitting ? "Creating…" : "Create giveaway"}
          </button>
        </form>
      </section>

      <section className="giveaway-list-section">
        <div className="section-heading">
          <div>
            <span className="label">Manage</span>
            <h2>Your Lab giveaways</h2>
          </div>
          <button
            className="btn"
            disabled={loading}
            onClick={() => void loadGiveaways()}
            type="button"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {giveaways.length === 0 && !loading ? (
          <div className="empty-state">
            <p>No Lab giveaways yet.</p>
          </div>
        ) : null}
        <div className="giveaway-list">
          {giveaways.map((giveaway) => {
            const effectiveStatus =
              giveaway.status === "OPEN" && new Date(giveaway.closesAt).getTime() <= now
                ? "CLOSED"
                : giveaway.status;
            const publicUrl =
              typeof window === "undefined"
                ? giveaway.publicUrl
                : new URL(giveaway.publicUrl, window.location.origin).toString();
            const payoutUri = giveaway.winnerAddress
              ? buildWalletLaunchUri({
                  amountKas: giveaway.amountKas,
                  recipientAddress: giveaway.winnerAddress,
                })
              : null;
            const payoutQr = qrById[giveaway.publicId];
            return (
              <article className="card giveaway-manage-card" key={giveaway.publicId}>
                <div className="giveaway-card-head">
                  <div>
                    <span className={`status-chip status-${effectiveStatus.toLowerCase()}`}>
                      {statusLabel(effectiveStatus)}
                    </span>
                    <h3>{giveaway.title}</h3>
                  </div>
                  <strong className="giveaway-amount">{giveaway.amountKas} KAS</strong>
                </div>
                {giveaway.description ? <p className="muted">{giveaway.description}</p> : null}
                <div className="giveaway-metrics">
                  <div>
                    <span>Entries</span>
                    <strong>{giveaway.entryCount}</strong>
                  </div>
                  <div>
                    <span>Closes</span>
                    <strong>{formatDeadline(giveaway.closesAt, now)}</strong>
                  </div>
                  <div>
                    <span>Commitment</span>
                    <code>{compactHash(giveaway.drawCommitment)}</code>
                  </div>
                </div>
                <div className="row giveaway-actions">
                  <Link className="btn" href={giveaway.publicUrl} target="_blank">
                    Open entry page
                  </Link>
                  <button
                    className="btn"
                    onClick={() => void copyText(publicUrl, "Entry link copied.")}
                    type="button"
                  >
                    Copy entry link
                  </button>
                  {effectiveStatus === "CLOSED" ? (
                    <button
                      className="btn btn-primary"
                      disabled={drawingId === giveaway.publicId}
                      onClick={() => void drawWinner(giveaway.publicId)}
                      type="button"
                    >
                      {drawingId === giveaway.publicId ? "Drawing…" : "Draw winner"}
                    </button>
                  ) : null}
                </div>

                {effectiveStatus === "DRAWN" && giveaway.winnerAddress && payoutUri ? (
                  <div className="giveaway-winner-panel">
                    <span className="label">Winner</span>
                    <h4>{compactAddress(giveaway.winnerAddress)}</h4>
                    <code>{giveaway.winnerAddress}</code>
                    <p>
                      Send exactly <strong>{giveaway.amountKas} KAS</strong>. The wallet remains the
                      final confirmation step.
                    </p>
                    <div className="row">
                      <a className="btn btn-primary" href={payoutUri}>
                        Open payout in wallet
                      </a>
                      <button
                        className="btn"
                        onClick={() =>
                          void copyText(giveaway.winnerAddress!, "Winner address copied.")
                        }
                        type="button"
                      >
                        Copy address
                      </button>
                      <button
                        className="btn"
                        onClick={() => void showPayoutQr(giveaway)}
                        type="button"
                      >
                        Show payout QR
                      </button>
                    </div>
                    {payoutQr ? (
                      <Image
                        alt={`Payout QR for ${giveaway.title}`}
                        className="giveaway-payout-qr"
                        height={420}
                        src={payoutQr}
                        unoptimized
                        width={420}
                      />
                    ) : null}
                  </div>
                ) : null}

                {effectiveStatus === "NO_ENTRIES" ? (
                  <div className="notice">No addresses were entered. Nothing needs to be paid.</div>
                ) : null}
                {giveaway.drawProof ? (
                  <details className="giveaway-proof">
                    <summary>Draw proof</summary>
                    <dl>
                      <dt>Seed</dt>
                      <dd>
                        <code>{giveaway.drawProof.seed}</code>
                      </dd>
                      <dt>Digest</dt>
                      <dd>
                        <code>{giveaway.drawProof.digest}</code>
                      </dd>
                      <dt>Winner index</dt>
                      <dd>{giveaway.drawProof.winnerIndex ?? "—"}</dd>
                    </dl>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function statusLabel(status: GiveawayStatus): string {
  if (status === "OPEN") return "Entries open";
  if (status === "CLOSED") return "Ready to draw";
  if (status === "DRAWN") return "Winner drawn";
  if (status === "NO_ENTRIES") return "No entries";
  return "Cancelled";
}

function formatDeadline(value: string, now: number): string {
  const remaining = new Date(value).getTime() - now;
  if (remaining <= 0) return new Date(value).toLocaleString();
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h remaining`;
  return `${Math.ceil(hours / 24)}d remaining`;
}

function compactAddress(value: string): string {
  return value.length <= 28 ? value : `${value.slice(0, 14)}…${value.slice(-10)}`;
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
