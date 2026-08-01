"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { GIVEAWAY_TURNSTILE_ACTION } from "@/lib/turnstile-shared";
import {
  verifyGiveawayDrawInBrowser,
  type BrowserGiveawayVerification,
} from "@/lib/giveaway-proof-browser";
import { kaspaStreamTransactionUrl } from "@/lib/kaspa-stream";
import { readJsonResponse } from "@/lib/response-json";

import { TurnstileWidget } from "./TurnstileWidget";

type PublicGiveaway = {
  amountKas: string;
  closesAt: string;
  description: null | string;
  drawCommitment: string;
  drawProtocol: {
    entropyBlockBlueScore: null | string;
    entropyBlockHash: null | string;
    entropyTargetBlueScore: null | string;
    entriesFrozenAt: null | string;
    entriesRoot: null | string;
    entryHashes: string[];
    entryCount: null | number;
    freezeCommitment: null | string;
    version: number;
  };
  drawProof: null | {
    digest: null | string;
    entryCount: null | number;
    entryHashes: string[];
    entropyBlockBlueScore: null | string;
    entropyBlockHash: null | string;
    entropyTargetBlueScore: null | string;
    entriesRoot: null | string;
    freezeCommitment: null | string;
    seed: string;
    version: number;
    winnerIndex: null | number;
  };
  entryCount: number;
  prize: null | {
    claimTxId: null | string;
    fundingAddress: string;
    fundingTxId: string;
    paidOut: boolean;
  };
  winnerClaim: {
    expiresAt: null | string;
    prepared: boolean;
    transactionId: null | string;
  };
  publicId: string;
  status: "CANCELLED" | "CLOSED" | "DRAWN" | "NO_ENTRIES" | "OPEN" | "PENDING_FUNDING";
  title: string;
  winnerAddress: null | string;
};

export function GiveawayEntryClient({
  publicId,
  turnstile,
}: {
  publicId: string;
  turnstile: { required: boolean; siteKey: string };
}) {
  const [giveaway, setGiveaway] = useState<null | PublicGiveaway>(null);
  const [address, setAddress] = useState("");
  const [entryHash, setEntryHash] = useState<null | string>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [claimingPrize, setClaimingPrize] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [now, setNow] = useState(() => Date.now());
  const [turnstileToken, setTurnstileToken] = useState<null | string>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [proofVerification, setProofVerification] = useState<null | BrowserGiveawayVerification>(
    null,
  );
  const [verifyingProof, setVerifyingProof] = useState(false);
  const [freezeReceiptChanged, setFreezeReceiptChanged] = useState(false);
  const finalizeInFlight = useRef(false);

  const loadGiveaway = useCallback(async () => {
    try {
      const response = await fetch(`/api/toccata-lab/giveaways/${encodeURIComponent(publicId)}`, {
        cache: "no-store",
      });
      const body = await readJsonResponse<{
        error?: { message?: string };
        giveaway?: PublicGiveaway;
      }>(response);
      if (!body) throw new Error("Giveaway could not be loaded. Please try again.");
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
        const body = await readJsonResponse<{ error?: { message?: string } }>(response);
        throw new Error(body?.error?.message ?? "Giveaway draw could not be completed.");
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
    if (!giveaway || giveaway.status === "NO_ENTRIES" || giveaway.status === "CANCELLED") {
      return;
    }
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (giveaway.status === "CLOSED") {
        void finalizeGiveaway();
      } else if (giveaway.status === "DRAWN") {
        if (
          giveaway.prize &&
          !giveaway.prize.paidOut &&
          (!giveaway.winnerClaim.expiresAt ||
            new Date(giveaway.winnerClaim.expiresAt).getTime() > Date.now())
        ) {
          void loadGiveaway();
        }
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
    if (turnstile.required && !turnstileToken) {
      setError("Complete the security check before entering.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/toccata-lab/giveaways/${encodeURIComponent(publicId)}/entries`,
        {
          body: JSON.stringify({ address, turnstileToken: turnstileToken ?? undefined }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const body = await readJsonResponse<{
        entry?: { entryHash: string };
        entryCount?: number;
        error?: { message?: string };
      }>(response);
      if (!body) {
        throw new Error("Entry service is temporarily unavailable. Please try again.");
      }
      if (!response.ok || !body.entry)
        throw new Error(body.error?.message ?? "Entry could not be submitted.");
      setEntryHash(body.entry.entryHash);
      setGiveaway((current) =>
        current ? { ...current, entryCount: body.entryCount ?? current.entryCount + 1 } : current,
      );
      window.localStorage.setItem(`kaspa-links:giveaway-entry:${publicId}`, body.entry.entryHash);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Entry could not be submitted.");
      if (turnstile.required) {
        setTurnstileToken(null);
        setTurnstileResetKey((current) => current + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function claimPrize(): Promise<void> {
    setClaimingPrize(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/toccata-lab/giveaways/${encodeURIComponent(publicId)}/claim-prize`,
        { method: "POST" },
      );
      const body = await readJsonResponse<{
        claimed?: boolean;
        error?: { message?: string };
        transactionId?: string;
      }>(response);
      if (!body || !response.ok || !body.claimed || !body.transactionId) {
        throw new Error(body?.error?.message ?? "Prize could not be claimed.");
      }
      setGiveaway((current) =>
        current?.prize
          ? {
              ...current,
              prize: {
                ...current.prize,
                claimTxId: body.transactionId!,
                paidOut: true,
              },
              winnerClaim: {
                ...current.winnerClaim,
                transactionId: body.transactionId!,
              },
            }
          : current,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prize could not be claimed.");
    } finally {
      setClaimingPrize(false);
    }
  }

  async function verifyDrawProof(): Promise<void> {
    if (
      !giveaway?.drawProof ||
      giveaway.drawProof.version < 2 ||
      !giveaway.drawProof.digest ||
      !giveaway.drawProof.entriesRoot ||
      !giveaway.drawProof.freezeCommitment ||
      !giveaway.drawProof.entropyTargetBlueScore ||
      !giveaway.drawProof.entropyBlockBlueScore ||
      !giveaway.drawProof.entropyBlockHash ||
      giveaway.drawProof.winnerIndex === null ||
      !giveaway.winnerAddress
    ) {
      return;
    }
    setVerifyingProof(true);
    setProofVerification(null);
    try {
      const result = await verifyGiveawayDrawInBrowser({
        closesAt: giveaway.closesAt,
        digest: giveaway.drawProof.digest,
        drawCommitment: giveaway.drawCommitment,
        entriesRoot: giveaway.drawProof.entriesRoot,
        entryHashes: giveaway.drawProof.entryHashes,
        entropyBlockBlueScore: giveaway.drawProof.entropyBlockBlueScore,
        entropyBlockHash: giveaway.drawProof.entropyBlockHash,
        entropyTargetBlueScore: giveaway.drawProof.entropyTargetBlueScore,
        freezeCommitment: giveaway.drawProof.freezeCommitment,
        publicId: giveaway.publicId,
        seed: giveaway.drawProof.seed,
        winnerAddress: giveaway.winnerAddress,
        winnerIndex: giveaway.drawProof.winnerIndex,
      });
      setProofVerification(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Draw proof could not be verified.");
    } finally {
      setVerifyingProof(false);
    }
  }

  useEffect(() => {
    setEntryHash(window.localStorage.getItem(`kaspa-links:giveaway-entry:${publicId}`));
  }, [publicId]);

  useEffect(() => {
    const protocol = giveaway?.drawProtocol;
    if (!protocol?.freezeCommitment || !protocol.entriesRoot) return;
    const key = `kaspa-links:giveaway-freeze:${publicId}`;
    const receipt = JSON.stringify({
      entriesRoot: protocol.entriesRoot,
      entryCount: protocol.entryCount,
      entropyTargetBlueScore: protocol.entropyTargetBlueScore,
      freezeCommitment: protocol.freezeCommitment,
    });
    const saved = window.localStorage.getItem(key);
    if (saved && saved !== receipt) {
      setFreezeReceiptChanged(true);
      return;
    }
    window.localStorage.setItem(key, receipt);
    setFreezeReceiptChanged(false);
  }, [giveaway?.drawProtocol, publicId]);

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
  const winnerClaimExpired = Boolean(
    giveaway.winnerClaim.expiresAt && new Date(giveaway.winnerClaim.expiresAt).getTime() <= now,
  );
  const entryIncluded = Boolean(entryHash && giveaway.drawProtocol.entryHashes.includes(entryHash));

  return (
    <main className="main giveaway-entry-page">
      <section className="giveaway-entry-hero">
        <span className="hero-eyebrow">Giveaway Lab</span>
        <h1>{giveaway.title}</h1>
        {giveaway.description ? <p>{giveaway.description}</p> : null}
        <div className="giveaway-hero-prize">
          <span className="label">Prize</span>
          <strong>{giveaway.amountKas} KAS</strong>
        </div>
      </section>

      {giveaway.prize ? (
        <section className="giveaway-verified-prize" aria-label="Verified prize funding">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Prize verified on-chain</strong>
            <p>The exact prize is parked in a one-time Kaspa output before entries open.</p>
          </div>
          <a
            href={kaspaStreamTransactionUrl(giveaway.prize.fundingTxId)}
            rel="noreferrer"
            target="_blank"
          >
            View funding
          </a>
        </section>
      ) : null}

      <section className="giveaway-draw-disclosure" aria-label="Giveaway draw trust model">
        <div className="giveaway-draw-disclosure-lead">
          <strong>Fair draw, verifiable on Kaspa</strong>
          <p>
            When entries close, the participant list is locked and a later Kaspa block supplies the
            random value that picks the winner — so nobody can choose the result in advance, and you
            can check it right here.
          </p>
        </div>
        <details className="giveaway-protocol-details">
          <summary>How does the fair draw work?</summary>
          <ol>
            <li>The participant list is locked when entries close.</li>
            <li>A newly confirmed Kaspa block supplies the random input.</li>
            <li>This page checks the list, the Kaspa block, and the selected winner for you.</li>
          </ol>
        </details>
      </section>

      <section className="card giveaway-entry-card">
        {freezeReceiptChanged ? (
          <div className="notice notice-error" role="alert">
            The published freeze receipt changed after this browser saved it. Do not trust this draw
            until the discrepancy is resolved.
          </div>
        ) : null}
        {status === "PENDING_FUNDING" ? (
          <div className="giveaway-result-state">
            <span className="label">Prize funding pending</span>
            <h2>Entries are not open yet</h2>
            <p>
              The creator is funding the prize. This page opens automatically after confirmation.
            </p>
          </div>
        ) : status === "OPEN" ? (
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
                {turnstile.required && turnstile.siteKey ? (
                  <div className="giveaway-security-check">
                    <TurnstileWidget
                      action={GIVEAWAY_TURNSTILE_ACTION}
                      onError={() => {
                        setTurnstileToken(null);
                        setError("Security verification could not be loaded. Please try again.");
                      }}
                      onToken={setTurnstileToken}
                      resetKey={turnstileResetKey}
                      siteKey={turnstile.siteKey}
                    />
                  </div>
                ) : null}
                {turnstile.required && !turnstile.siteKey ? (
                  <div className="notice notice-error" role="alert">
                    Security verification is temporarily unavailable.
                  </div>
                ) : null}
                <button
                  className="btn btn-primary"
                  disabled={
                    submitting || (turnstile.required && (!turnstile.siteKey || !turnstileToken))
                  }
                  type="submit"
                >
                  {submitting ? "Entering…" : "Enter giveaway"}
                </button>
              </form>
            )}
          </>
        ) : status === "CLOSED" ? (
          <div className="giveaway-result-state">
            <span className="label">
              {giveaway.drawProtocol.entriesFrozenAt ? "Entries frozen" : "Entries closed"}
            </span>
            <h2>
              {giveaway.drawProtocol.entriesFrozenAt
                ? "Waiting for future Kaspa entropy"
                : finalizing
                  ? "Freezing the participant list…"
                  : "Finalizing the participant list"}
            </h2>
            <p>
              {giveaway.drawProtocol.entropyTargetBlueScore
                ? `The draw uses the confirmed chain block at or after blue score ${giveaway.drawProtocol.entropyTargetBlueScore}.`
                : "The participant root and future chain target are published before the winner can be known."}
            </p>
          </div>
        ) : status === "DRAWN" ? (
          <div className={`giveaway-result-state${isWinner ? " is-winner" : ""}`}>
            <span className="label">Draw complete</span>
            <h2>{isWinner ? "You won" : "A winner was selected"}</h2>
            <p>Winning address</p>
            <code>{giveaway.winnerAddress}</code>
            {isWinner ? (
              <p>
                {giveaway.prize?.paidOut
                  ? "The prize was sent to your winning address on-chain."
                  : giveaway.prize && winnerClaimExpired
                    ? "The winner claim window has ended. The creator can now recover the unclaimed prize."
                    : giveaway.prize?.fundingTxId && giveaway.winnerClaim.prepared
                      ? "Your claim is ready. The prepared transaction can only pay the winning address."
                      : giveaway.prize
                        ? "The creator is preparing your fixed-address winner claim."
                        : "The creator still needs to send the KAS from their wallet. Kaspa Links never holds the prize."}
              </p>
            ) : null}
            {giveaway.prize &&
            !giveaway.prize.paidOut &&
            giveaway.winnerClaim.prepared &&
            !winnerClaimExpired ? (
              <div className="giveaway-winner-claim">
                <span className="label">Claim available for</span>
                <strong>{countdown(giveaway.winnerClaim.expiresAt!, now)}</strong>
                <button
                  className="btn btn-primary"
                  disabled={claimingPrize}
                  onClick={() => void claimPrize()}
                  type="button"
                >
                  {claimingPrize ? "Sending prize…" : "Claim prize"}
                </button>
                <p>
                  The signed transaction is already fixed to the winning address. Nobody pressing
                  this button can redirect the KAS.
                </p>
              </div>
            ) : null}
            {giveaway.prize &&
            !giveaway.prize.paidOut &&
            giveaway.winnerClaim.expiresAt &&
            !winnerClaimExpired &&
            !giveaway.winnerClaim.prepared ? (
              <p>
                Claim window: {countdown(giveaway.winnerClaim.expiresAt, now)}. Waiting for the
                creator browser to prepare the winner claim.
              </p>
            ) : null}
            {giveaway.prize?.paidOut && giveaway.prize.claimTxId ? (
              <a
                className="giveaway-claim-transaction"
                href={kaspaStreamTransactionUrl(giveaway.prize.claimTxId)}
                rel="noreferrer"
                target="_blank"
              >
                View prize transaction
              </a>
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
          {giveaway.drawProtocol.entriesRoot ? (
            <span>
              Frozen root <code>{compactHash(giveaway.drawProtocol.entriesRoot)}</code>
            </span>
          ) : null}
        </div>
        {entryHash ? (
          <details className="giveaway-proof">
            <summary>Your entry receipt</summary>
            <code>{entryHash}</code>
            {giveaway.drawProtocol.entriesFrozenAt ? (
              <strong className={entryIncluded ? "proof-entry-included" : "proof-entry-missing"}>
                {entryIncluded
                  ? "Included in the frozen participant manifest."
                  : "Not included in the frozen participant manifest. Do not trust this draw."}
              </strong>
            ) : null}
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
              {giveaway.drawProof.version >= 2 ? (
                <>
                  <dt>Frozen entry root</dt>
                  <dd>
                    <code>{giveaway.drawProof.entriesRoot}</code>
                  </dd>
                  <dt>Future entropy target</dt>
                  <dd>{giveaway.drawProof.entropyTargetBlueScore}</dd>
                  <dt>Entropy chain block</dt>
                  <dd>
                    <code>{giveaway.drawProof.entropyBlockHash}</code>
                  </dd>
                  <dt>Entropy block blue score</dt>
                  <dd>{giveaway.drawProof.entropyBlockBlueScore}</dd>
                </>
              ) : null}
            </dl>
            {giveaway.drawProof.version >= 2 ? (
              <div className="giveaway-proof-verifier">
                <button
                  className="btn"
                  disabled={verifyingProof}
                  onClick={() => void verifyDrawProof()}
                  type="button"
                >
                  {verifyingProof ? "Verifying…" : "Verify draw in this browser"}
                </button>
                {proofVerification ? (
                  <strong className={proofVerification.valid ? "is-valid" : "is-invalid"}>
                    {proofVerification.valid
                      ? "Verified locally: root, seed, chain entropy, digest, and winner match."
                      : "Verification failed. Do not trust this draw result."}
                  </strong>
                ) : null}
              </div>
            ) : null}
          </details>
        ) : null}
      </section>

      <p className="giveaway-entry-footnote">
        One entry per Kaspa address. Addresses are checked for format, not wallet ownership. No
        funds or wallet keys are held by Kaspa Links.
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
