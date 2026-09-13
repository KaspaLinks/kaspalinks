"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { buildWalletLaunchUri } from "@/lib/wallet-uri";
import { savePrivateRecoveryFile } from "@/lib/private-recovery-download";
import {
  createPrototypeRecoveryKey,
  signPrototypeRefund,
  verifyPrototypeRecoveryKey,
} from "./browser";

import {
  studioState,
  studioStep,
  studioRefundReady,
  remainingTime,
  type StudioTrial as Trial,
  type StudioDetail as Detail,
} from "./studio-state";
const endpoint = "/api/toccata-lab/prize-covenant";
const kas = (value: string) => {
  const n = BigInt(value);
  return `${n / 100_000_000n}.${(n % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "") || "0"} KAS`;
};
function headers(): Record<string, string> {
  const token = sessionStorage.getItem("kaspa-actions:creator-token");
  const username = sessionStorage.getItem("kaspa-actions:creator-username");
  if (token && username)
    return {
      "content-type": "application/json",
      "x-creator-username": username,
      authorization: `Bearer ${token}`,
    };
  const initData = window.Telegram?.WebApp?.initData;
  return {
    "content-type": "application/json",
    ...(initData ? { "x-telegram-mini-app-init-data": initData } : {}),
  };
}
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "Request failed.");
  return data as T;
}
export default function PrototypeClient() {
  const [review, setReview] = useState(false);
  const [accessReady, setAccessReady] = useState(false);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [chainFresh, setChainFresh] = useState(false);
  const [title, setTitle] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [qr, setQr] = useState<{ uri: string; src: string } | null>(null);
  const [prize, setPrize] = useState("20000000");
  const [recovery, setRecovery] = useState<{ id: string; privateKeyHex: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [refundAddress, setRefundAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [message, setMessage] = useState("");
  const [txId, setTxId] = useState<string | null>(null);
  const run = useCallback(async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  const refresh = useCallback(async (id?: string) => {
    if (id) {
      setChainFresh(false);
      setDetail(await api<Detail>(`${endpoint}?id=${encodeURIComponent(id)}`));
      setChainFresh(true);
    } else {
      const data = await api<{ prototypes: Trial[] }>(endpoint);
      setTrials(data.prototypes);
      setAccessReady(true);
    }
  }, []);
  useEffect(() => {
    void run(() => refresh());
  }, [refresh, run]);
  const selectedId = detail?.id;
  useEffect(() => {
    if (!selectedId) return;
    const update = () => {
      if (document.visibilityState !== "visible") {
        setChainFresh(false);
        return;
      }
      if (lock.current) return;
      lock.current = true;
      void api<Detail>(`${endpoint}?id=${encodeURIComponent(selectedId)}`)
        .then((updated) => {
          setDetail(updated);
          setChainFresh(true);
        })
        .catch(() => {
          setChainFresh(false);
          setMessage("Status could not be updated. Refresh before continuing.");
        })
        .finally(() => {
          lock.current = false;
        });
    };
    const timer = window.setInterval(update, 20_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [selectedId, refresh, run]);
  const create = () =>
    run(async () => {
      const key = await createPrototypeRecoveryKey();
      const created = await api<Trial>(endpoint, {
        action: "create",
        input: {
          creatorPublicKeyHex: key.publicKeyHex,
          prizeSompi: prize,
          durationMinutes,
          addresses: [],
          publicTitle: title,
        },
      });
      setTrials((current) => [created, ...current]);
      setRecovery({ id: created.id, privateKeyHex: key.privateKeyHex });
      setSaved(false);
      setTxId(null);
      await refresh(created.id);
    });
  const submit = (action: "freeze" | "draw") =>
    run(async () => {
      if (!detail) return;
      const result = await api<{ transactionId: string; winnerAddress: string | null }>(endpoint, {
        action,
        id: detail.id,
      });
      setTxId(result.transactionId);
      setMessage("Submitted. Refresh after the transaction confirms.");
      await refresh(detail.id);
    });
  const recover = (phase: "open" | "frozen") =>
    run(async () => {
      if (!detail || recovery?.id !== detail.id)
        throw new Error("Import this prototype's recovery file first.");
      const prepared = await api<{ transactionSafeJson: string }>(endpoint, {
        action: "prepare-refund",
        id: detail.id,
        phase,
        refundAddress,
      });
      const transactionSafeJson = await signPrototypeRefund({
        ...prepared,
        privateKeyHex: recovery.privateKeyHex,
        publicKeyHex: detail.manifest.creatorPublicKeyHex,
        refundAddress,
      });
      const result = await api<{ transactionId: string }>(endpoint, {
        action: "broadcast-refund",
        id: detail.id,
        phase,
        refundAddress,
        transactionSafeJson,
      });
      setTxId(result.transactionId);
      setMessage("Refund submitted. Refresh after confirmation.");
      await refresh(detail.id);
    });
  const daa = BigInt(detail?.chain.daa ?? "0");
  const fundingUri = detail
    ? buildWalletLaunchUri({
        recipientAddress: detail.terms.open.address,
        amountKas: kas(detail.terms.fundingSompi).replace(" KAS", ""),
      })
    : "";
  useEffect(() => {
    if (!fundingUri) return;
    let active = true;
    void import("qrcode")
      .then((q) => q.toDataURL(fundingUri, { width: 280, margin: 2, errorCorrectionLevel: "M" }))
      .then((src) => {
        if (active) setQr({ uri: fundingUri, src });
      })
      .catch(() => {
        if (active) setQr(null);
      });
    return () => {
      active = false;
    };
  }, [fundingUri]);
  const backedUp = Boolean(detail && saved && recovery?.id === detail.id);
  const state = detail ? studioState(detail, chainFresh, backedUp) : "backup";
  const step = detail ? studioStep(studioState(detail, true, backedUp)) : 0;
  const confirmed = state === "paid" || state === "refunded";
  const shareUrl =
    detail?.publicTitle && typeof window !== "undefined"
      ? `${window.location.origin}/giveaways/${detail.id}`
      : "";
  const returnPhase = detail
    ? (["frozen", "open"] as const).find((phase) => studioRefundReady(detail, phase))
    : undefined;
  const total = (BigInt(prize) + 2_000_000n).toString();
  const durationLabel =
    durationMinutes < 60 ? `${durationMinutes} minutes` : `${durationMinutes / 60} hours`;
  const copy = (value: string, feedback: string) =>
    run(async () => {
      await navigator.clipboard.writeText(value);
      setMessage(feedback);
    });
  const saveRecovery = () =>
    run(async () => {
      if (!detail || recovery?.id !== detail.id) return;
      await savePrivateRecoveryFile(
        new File(
          [
            JSON.stringify(
              {
                format: "kaspalinks-covenant-prototype-v3",
                id: detail.id,
                privateKeyHex: recovery.privateKeyHex,
                manifest: detail.manifest,
                terms: detail.terms,
              },
              null,
              2,
            ),
          ],
          `covenant-${detail.id}-recovery.json`,
          { type: "application/json" },
        ),
        false,
      );
      setMessage("Recovery file prepared. Confirm below once you have saved it safely.");
    });
  const importRecovery = (file: File) =>
    run(async () => {
      if (!detail) return;
      if (file.size > 100_000) throw new Error("Recovery file is too large.");
      const data = JSON.parse(await file.text());
      if (
        data.format !== "kaspalinks-covenant-prototype-v3" ||
        data.id !== detail.id ||
        !/^[0-9a-f]{64}$/.test(data.privateKeyHex)
      )
        throw new Error("Choose the recovery file for this giveaway.");
      await verifyPrototypeRecoveryKey(data.privateKeyHex, detail.manifest.creatorPublicKeyHex);
      setRecovery({ id: data.id, privateKeyHex: data.privateKeyHex });
      setSaved(true);
      setMessage("Recovery file matched. You can continue.");
    });
  const upload = (
    <label className="studio-file">
      <span>
        {recovery?.id === detail?.id ? "Choose another recovery file" : "Choose recovery file"}
      </span>
      <input
        type="file"
        accept="application/json,.json"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importRecovery(file);
        }}
      />
    </label>
  );
  const share = shareUrl && (
    <div className="studio-share">
      <label className="field">
        <span className="label">Your participation link</span>
        <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
      </label>
      <div className="studio-actions">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void copy(shareUrl, "Participation link copied.")}
        >
          Copy link
        </button>
        <a
          className="btn"
          href={`https://x.com/intent/post?text=${encodeURIComponent(`${detail?.publicTitle} — join my Kaspa giveaway! ${shareUrl}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Share on X
        </a>
        <Link className="btn" href={`/giveaways/${detail!.id}`}>
          View public page
        </Link>
      </div>
    </div>
  );
  const returnForm = detail && (
    <div className="studio-return">
      {recovery?.id !== detail.id ? (
        <>
          <p>Choose the recovery file you saved for this giveaway.</p>
          {upload}
        </>
      ) : (
        <p className="studio-check">✓ Recovery file matched</p>
      )}
      <label className="field">
        <span className="label">Return KAS to this wallet address</span>
        <input
          value={refundAddress}
          onChange={(e) => setRefundAddress(e.target.value)}
          placeholder="kaspa:…"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
        />
      </label>
      <button
        className="btn btn-primary"
        disabled={
          busy ||
          !chainFresh ||
          !returnPhase ||
          state === "refunding" ||
          (state === "drawing" && Boolean(detail.payout)) ||
          recovery?.id !== detail.id ||
          !refundAddress.trim()
        }
        onClick={() => returnPhase && void recover(returnPhase)}
      >
        Return KAS to my wallet
      </button>
      <p className="studio-caption">
        Fee: 0.01 KAS per refund. Signing happens only in this browser.
      </p>
    </div>
  );
  return (
    <main className="main giveaway-studio">
      <header className="studio-header">
        <Link className="studio-back" href="/new-link">
          ← Create a new link
        </Link>
        <div className="studio-heading">
          <div>
            <span className="label">Creator tools</span>
            <h1>Giveaway studio</h1>
          </div>
          <span className="studio-network">
            <span aria-hidden="true">●</span> Kaspa Mainnet
          </span>
        </div>
        <p>Create a prize, share your link, and let the giveaway run.</p>
      </header>
      <ol className="studio-steps" aria-label="Giveaway setup progress">
        {["Set up", "Save recovery", "Fund prize", "Share & track"].map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={index < step || confirmed ? "is-done" : index === step ? "is-current" : ""}
          >
            <span className="studio-step-dot">{index < step || confirmed ? "✓" : index + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      {message && (
        <div className="notice studio-notice" role="status" aria-live="polite">
          {message}
        </div>
      )}
      {txId && (
        <p className="studio-caption">
          <a href={`https://explorer.kaspa.org/txs/${txId}`} target="_blank" rel="noreferrer">
            View submitted transaction ↗
          </a>
        </p>
      )}
      {!detail ? (
        <div className="studio-layout">
          <section className="card studio-panel">
            <div className="studio-panel-heading">
              <span className="studio-kicker">Step 1 of 4</span>
              <h2>{review ? "Ready to create?" : "Make it yours"}</h2>
              <p>
                {review
                  ? "Check your prize and timing before the giveaway starts."
                  : "Choose a title, prize and how long people can enter."}
              </p>
            </div>
            {!review ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setReview(true);
                }}
                className="studio-form"
              >
                <label className="field">
                  <span className="label">Giveaway title</span>
                  <input
                    id="giveaway-title"
                    placeholder="A little KAS for our community"
                    required
                    minLength={3}
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <fieldset className="studio-prizes">
                  <legend className="label">Prize for the winner</legend>
                  {["20000000", "50000000", "100000000"].map((value) => (
                    <label key={value} className={prize === value ? "is-selected" : ""}>
                      <input
                        type="radio"
                        name="prize"
                        value={value}
                        checked={prize === value}
                        onChange={() => setPrize(value)}
                        disabled={busy}
                      />
                      <span>{kas(value)}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="field">
                  <span className="label">People can enter for</span>
                  <select
                    id="duration"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    disabled={busy}
                  >
                    {[5, 15, 30, 60, 360, 720, 1440].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes < 60
                          ? `${minutes} minutes`
                          : `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="studio-cost">
                  <span>Total funding</span>
                  <strong>{kas(total)}</strong>
                  <small>Includes 0.02 KAS reserved for processing. Wallet fee is extra.</small>
                </div>
                <button
                  className="btn btn-primary studio-primary"
                  disabled={busy || !accessReady || title.trim().length < 3}
                >
                  Review giveaway →
                </button>
              </form>
            ) : (
              <div className="studio-review">
                <h3>{title.trim()}</h3>
                <dl className="studio-summary">
                  <div>
                    <dt>Winner receives</dt>
                    <dd>{kas(prize)}</dd>
                  </div>
                  <div>
                    <dt>Entry duration</dt>
                    <dd>{durationLabel}</dd>
                  </div>
                  <div>
                    <dt>Participants</dt>
                    <dd>Up to 100 · one winner</dd>
                  </div>
                  <div>
                    <dt>Total to fund</dt>
                    <dd>{kas(total)}</dd>
                  </div>
                </dl>
                <div className="studio-hint">
                  <strong>Your timer starts when you create.</strong>
                  <p>Have your wallet ready. Next, save recovery and fund before entries close.</p>
                </div>
                <div className="studio-actions">
                  <button className="btn" disabled={busy} onClick={() => setReview(false)}>
                    Edit details
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !accessReady}
                    onClick={() => void create()}
                  >
                    {busy ? "Creating…" : "Create & save recovery →"}
                  </button>
                </div>
              </div>
            )}
            {!accessReady && (
              <p>
                <Link href="/sign-in?next=%2Ftoccata-lab%2Fprize-covenant">
                  Sign in to your creator account
                </Link>
              </p>
            )}
          </section>
          <aside className="studio-sidebar">
            <section className="card studio-guide">
              <h2>How it works</h2>
              <ol>
                <li>
                  <strong>Save your recovery file</strong>
                  <span>Keep control if the prize needs to come back.</span>
                </li>
                <li>
                  <strong>Fund the prize</strong>
                  <span>Scan a QR code or open your wallet.</span>
                </li>
                <li>
                  <strong>Share and relax</strong>
                  <span>People enter; the winner is paid automatically.</span>
                </li>
              </ol>
              <p className="studio-caption">
                No participants? Recover after the empty list is confirmed.
              </p>
            </section>
            <section className="card studio-history">
              <h2>Your giveaways</h2>
              {trials.length ? (
                <ul>
                  {trials.map((trial) => (
                    <li key={trial.id}>
                      <button disabled={busy} onClick={() => void run(() => refresh(trial.id))}>
                        <span>{trial.publicTitle ?? `Giveaway ${trial.id.slice(-8)}`}</span>
                        <small>{kas(trial.manifest.prizeSompi)}</small>
                        <span aria-hidden="true">→</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Your giveaways will appear here.</p>
              )}
            </section>
          </aside>
        </div>
      ) : (
        <>
          <div className="studio-toolbar">
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await refresh();
                  setDetail(null);
                  setTxId(null);
                  setReview(false);
                })
              }
            >
              ← My giveaways
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => void run(() => refresh(detail.id))}
            >
              {busy ? "Updating…" : "Refresh status"}
            </button>
          </div>
          <section className="card studio-panel studio-detail">
            <div className="studio-detail-heading">
              <h2>{detail.publicTitle ?? "Your giveaway"}</h2>
              <span className="studio-prize-badge">{kas(detail.manifest.prizeSompi)}</span>
            </div>
            {state === "checking" ? (
              <div className="studio-state" role="status">
                <span className="studio-state-icon" aria-hidden="true">
                  …
                </span>
                <h3>Checking your giveaway</h3>
                <p>Waiting for fresh blockchain information.</p>
              </div>
            ) : state === "backup" ? (
              <>
                <div className="studio-panel-heading">
                  <span className="studio-kicker">Step 2 of 4</span>
                  <h3>Keep your recovery file safe</h3>
                  <p>You’ll need it to return an unclaimed prize to your wallet.</p>
                </div>
                {recovery?.id === detail.id ? (
                  <>
                    <button
                      className="btn btn-primary studio-primary"
                      disabled={busy}
                      onClick={() => void saveRecovery()}
                    >
                      Save recovery file ↓
                    </button>
                    <label className="studio-confirm">
                      <input
                        type="checkbox"
                        checked={backedUp}
                        disabled={busy}
                        onChange={(e) => setSaved(e.target.checked)}
                      />
                      <span>I saved the file somewhere safe.</span>
                    </label>
                  </>
                ) : (
                  upload
                )}
                <p className="studio-caption">
                  Keep it private. Never send it to us or post it with your giveaway.
                </p>
                <div className="studio-hint">
                  Fund within approximately{" "}
                  {remainingTime(detail.manifest.closesAtDaa, detail.chain.daa)}.
                </div>
              </>
            ) : state === "fund" ? (
              <>
                <div className="studio-panel-heading">
                  <span className="studio-kicker">Step 3 of 4</span>
                  <h3>Fund your prize</h3>
                  <p>Send exactly this amount in one payment.</p>
                </div>
                <div className="studio-funding">
                  <div className="studio-qr">
                    {qr?.uri === fundingUri ? (
                      <Image
                        src={qr.src}
                        alt={`Funding QR for ${kas(detail.terms.fundingSompi)}`}
                        width={280}
                        height={280}
                        unoptimized
                      />
                    ) : (
                      <span>Preparing QR…</span>
                    )}
                  </div>
                  <div>
                    <strong className="studio-funding-amount">
                      {kas(detail.terms.fundingSompi)}
                    </strong>
                    <p className="studio-caption">
                      Prize + reserved processing fees. Your wallet adds its fee.
                    </p>
                    <a className="btn btn-primary studio-primary" href={fundingUri}>
                      Open wallet
                    </a>
                    <label className="field">
                      <span className="label">Funding address</span>
                      <textarea
                        readOnly
                        rows={3}
                        value={detail.terms.open.address}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void copy(detail.terms.open.address, "Funding address copied.")
                      }
                    >
                      Copy address
                    </button>
                  </div>
                </div>
                <div className="studio-hint">
                  We’ll detect your payment automatically. Fund within approximately{" "}
                  {remainingTime(detail.manifest.closesAtDaa, detail.chain.daa)}.
                </div>
              </>
            ) : state === "active" ? (
              <>
                <div className="studio-state">
                  <span className="studio-state-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span className="studio-kicker">Step 4 of 4</span>
                  <h3>Your giveaway is live</h3>
                  <p>Share the link. Participants enter their own address.</p>
                </div>
                <div className="studio-metrics">
                  <div>
                    <strong>
                      {detail.entryCount ?? detail.manifest.entries.length}
                      <small> / 100</small>
                    </strong>
                    <span>Participants</span>
                  </div>
                  <div>
                    <strong>{remainingTime(detail.manifest.closesAtDaa, detail.chain.daa)}</strong>
                    <span>Until entries close · approx.</span>
                  </div>
                </div>
                {share}
                <p className="studio-caption">
                  {detail.manifest.version === 4
                    ? "The draw and payout run automatically. You can close this page."
                    : "This older giveaway needs you to freeze and draw under Advanced below."}
                </p>
              </>
            ) : state === "paid" ? (
              <div className="studio-state">
                <span className="studio-state-icon" aria-hidden="true">
                  ✓
                </span>
                <h3>Winner paid!</h3>
                <p>{kas(detail.manifest.prizeSompi)} delivered · confirmed on Mainnet</p>
                <p className="studio-address">{detail.payout?.winnerAddress}</p>
                <a
                  className="btn btn-primary"
                  href={`https://explorer.kaspa.org/txs/${detail.payout?.transactionId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View payout
                </a>
                {share}
              </div>
            ) : state === "refunded" ? (
              <div className="studio-state">
                <span className="studio-state-icon" aria-hidden="true">
                  ✓
                </span>
                <h3>KAS returned to your wallet</h3>
                <p>
                  {detail.refund?.amount ? kas(detail.refund.amount) : "Refund"} · confirmed on
                  Mainnet
                </p>
                <p className="studio-address">{detail.refund?.address}</p>
                <a
                  className="btn btn-primary"
                  href={`https://explorer.kaspa.org/txs/${detail.refund?.transactionId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View refund
                </a>
              </div>
            ) : state === "refund" ? (
              <>
                <div className="studio-panel-heading">
                  <h3>
                    {detail.entryCount === 0
                      ? "No entries this time"
                      : "Your remaining KAS can be returned"}
                  </h3>
                  <p>Return the unspent balance to your wallet.</p>
                </div>
                {returnForm}
              </>
            ) : state === "refund-wait" ? (
              <>
                <div className="studio-state">
                  <span className="studio-state-icon" aria-hidden="true">
                    ↩
                  </span>
                  <h3>No entries this time</h3>
                  <p>
                    {detail.manifest.version === 4
                      ? "We’re confirming the empty list. Your refund action will appear here automatically."
                      : `Recovery unlocks in approximately ${remainingTime(detail.manifest.refundDaa, detail.chain.daa)} under this giveaway’s original rules.`}
                  </p>
                </div>
                {recovery?.id !== detail.id && (
                  <>
                    <p>You can select your recovery file while you wait.</p>
                    {upload}
                  </>
                )}
              </>
            ) : state === "drawing" ? (
              <div className="studio-state">
                <span className="studio-state-icon" aria-hidden="true">
                  ✦
                </span>
                <h3>Entries closed · drawing the winner</h3>
                <p>
                  {detail.manifest.version === 4
                    ? "The list is being locked and the committed randomness block confirmed. The winner is paid automatically."
                    : "Use the manual controls under Advanced to finish this older giveaway."}
                </p>
                <strong>{detail.entryCount ?? detail.manifest.entries.length} participants</strong>
                {detail.payout && (
                  <p>
                    <a
                      href={`https://explorer.kaspa.org/txs/${detail.payout.transactionId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Track submitted payout
                    </a>
                  </p>
                )}
                {share}
              </div>
            ) : state === "refunding" ? (
              <div className="studio-state">
                <span className="studio-state-icon" aria-hidden="true">
                  ↩
                </span>
                <h3>Refund submitted</h3>
                <p>Waiting for confirmation. Please don’t submit another refund yet.</p>
                <a
                  href={`https://explorer.kaspa.org/txs/${detail.refund?.transactionId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Track refund
                </a>
              </div>
            ) : state === "mismatch" ? (
              <div className="studio-state">
                <h3>Check the funding amount</h3>
                <p>
                  We found an output, but not the required {kas(detail.terms.fundingSompi)} in one
                  payment. Please check your transaction before sending anything else.
                </p>
                <p>Recovery remains available under the committed deadline.</p>
              </div>
            ) : (
              <div className="studio-state">
                <h3>This giveaway has ended</h3>
                <p>
                  No spendable prize output was found. This alone does not confirm a payout or
                  refund.
                </p>
                <a
                  href={`https://explorer.kaspa.org/addresses/${detail.terms.open.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Check funding history
                </a>
              </div>
            )}
          </section>
          <details className="card studio-advanced">
            <summary>Advanced · recovery & transaction details</summary>
            <div className="studio-advanced-body">
              {recovery?.id === detail.id && (
                <button className="btn" disabled={busy} onClick={() => void saveRecovery()}>
                  Save recovery file again
                </button>
              )}
              {upload}
              {!confirmed && state !== "refund" && returnForm}
              <h3>Manual processing</h3>
              <p className="studio-caption">
                Fallback controls. New giveaways normally run automatically.
              </p>
              <div className="studio-actions">
                <button
                  className="btn"
                  disabled={
                    busy ||
                    !chainFresh ||
                    Boolean(detail.payout) ||
                    daa <= BigInt(detail.manifest.closesAtDaa) ||
                    daa >= BigInt(detail.manifest.refundDaa) ||
                    !detail.open.some((e) => e.amount === detail.terms.fundingSompi)
                  }
                  onClick={() => void submit("freeze")}
                >
                  Freeze participants
                </button>
                <button
                  className="btn"
                  disabled={
                    busy ||
                    !chainFresh ||
                    Boolean(detail.payout) ||
                    !detail.manifest.entries.length ||
                    daa >= BigInt(detail.manifest.refundDaa) ||
                    !detail.frozen.some(
                      (e) =>
                        BigInt(e.amount) ===
                        BigInt(detail.manifest.prizeSompi) + BigInt(detail.manifest.drawFeeSompi),
                    ) ||
                    BigInt(detail.chain.blueScore) <
                      BigInt(detail.manifest.entropyTargetBlueScore) + 100n
                  }
                  onClick={() => void submit("draw")}
                >
                  Draw and pay
                </button>
              </div>
              <dl className="studio-summary">
                <div>
                  <dt>Close DAA</dt>
                  <dd>{detail.manifest.closesAtDaa}</dd>
                </div>
                <div>
                  <dt>Fallback refund DAA</dt>
                  <dd>{detail.manifest.refundDaa}</dd>
                </div>
                <div>
                  <dt>Entropy target</dt>
                  <dd>{detail.manifest.entropyTargetBlueScore}</dd>
                </div>
              </dl>
              {detail.manifest.entries.length > 0 && (
                <details>
                  <summary>Committed participant addresses</summary>
                  <ol>
                    {detail.manifest.entries.map((e) => (
                      <li className="studio-address" key={e.hash}>
                        {e.address}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </details>
        </>
      )}
      <details className="studio-rules">
        <summary>Fees, recovery and how the draw works</summary>
        <p>
          Funds go into the SilverScript covenant. Two processing fees of 0.01 KAS are reserved;
          funding-wallet fees are separate. The platform confirms the participant list and
          randomness block. New giveaways run automatically after closing and block confirmation. A
          confirmed empty list enables browser-signed recovery; other unspent prizes use the
          committed fallback deadline. Keep your recovery file private.
        </p>
      </details>
    </main>
  );
}
