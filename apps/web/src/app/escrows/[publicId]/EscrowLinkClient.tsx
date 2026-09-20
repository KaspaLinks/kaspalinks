"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createEscrowPasskey,
  escrowPasskeySupported,
  readEscrowPasskeyPrf,
} from "@/lib/escrow-passkey-browser";
import {
  deriveEscrowSignerPublicIdentity,
  type EscrowSignerContext,
} from "@/lib/escrow-passkey-signer";
import { FundingQrCode } from "@/lib/funding-qr";
import { buildWalletLaunchUri } from "@/lib/wallet-uri";
import {
  signPreparedEscrowCanary,
  type EscrowCanaryMode,
  type PreparedEscrowCanary,
} from "../../toccata-lab/passkey-signer/escrow-canary-browser";

type PublicEscrow = {
  activeFundingAddress: null | string;
  amountSompi: string;
  buyerAddress: null | string;
  buyerPublicKey: null | string;
  chainDaa: null | string;
  claimAvailable: boolean;
  creatorUsername: string;
  durationDaa: string;
  feeSompi: string;
  frozenFundingAddress: null | string;
  funding: {
    state: "ambiguous" | "awaiting_funding" | "funded" | "not_ready";
    unexpectedOutputCount: number;
  };
  fundingAmountSompi: string;
  publicId: string;
  releaseAfter: null | string;
  sellerAddress: string;
  sellerPublicKey: string;
  signerContextId: string;
  status: string;
  submitted: null | { mode: EscrowCanaryMode; transactionId: string };
  title: string;
};

function sessionRead(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function sessionWrite(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* A discoverable passkey can still be selected manually. */
  }
}

function roleContext(escrow: PublicEscrow, role: "buyer" | "seller"): EscrowSignerContext {
  return {
    escrowId: escrow.signerContextId,
    network: "mainnet",
    role,
    signerVersion: 1,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "The escrow request failed.");
  return body;
}

export function EscrowLinkClient({ publicId }: { publicId: string }) {
  const [escrow, setEscrow] = useState<PublicEscrow | null>(null);
  const [buyerAddress, setBuyerAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState<PreparedEscrowCanary | null>(null);

  const buyerCredentialKey = `kaspalinks:escrow:${publicId}:buyer-credential`;
  const sellerCredentialKey = `kaspalinks:escrow:${publicId}:seller-credential`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/escrows/${publicId}`, { cache: "no-store" });
      const body = await parseResponse<{ escrow: PublicEscrow }>(response);
      setEscrow(body.escrow);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load this escrow.");
    }
  }, [publicId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const paymentUri = useMemo(() => {
    if (!escrow?.activeFundingAddress) return "";
    return buildWalletLaunchUri({
      amountKas: "0.22",
      recipientAddress: escrow.activeFundingAddress,
    });
  }, [escrow?.activeFundingAddress]);

  async function join(create: boolean) {
    if (!escrow || !buyerAddress.trim() || !escrowPasskeySupported()) {
      setMessage("Open this link directly in Safari or Chrome and enter a Kaspa address.");
      return;
    }
    setBusy(true);
    setMessage(create ? "Creating your buyer passkey…" : "Select your buyer passkey…");
    let prfOutput: Uint8Array | null = null;
    try {
      const context = roleContext(escrow, "buyer");
      const createdId = create
        ? await createEscrowPasskey(context, `Buyer · ${escrow.title}`)
        : sessionRead(buyerCredentialKey);
      const result = await readEscrowPasskeyPrf(context, createdId || undefined);
      prfOutput = result.output;
      const identity = await deriveEscrowSignerPublicIdentity(prfOutput, context);
      const response = await fetch(`/api/escrows/${publicId}`, {
        body: JSON.stringify({
          action: "join",
          buyerAddress: buyerAddress.trim(),
          buyerPublicKey: identity.publicKey,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await parseResponse<{ escrow: PublicEscrow }>(response);
      sessionWrite(buyerCredentialKey, result.credentialId);
      setEscrow(body.escrow);
      setMessage("Escrow accepted. The funding address is now locked to both parties.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not accept this escrow.");
    } finally {
      prfOutput?.fill(0);
      setBusy(false);
    }
  }

  async function prepare(mode: EscrowCanaryMode) {
    setBusy(true);
    setPrepared(null);
    setMessage("Preparing the exact on-chain transaction…");
    try {
      const response = await fetch(`/api/escrows/${publicId}`, {
        body: JSON.stringify({ action: "prepare", mode }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setPrepared(await parseResponse<PreparedEscrowCanary>(response));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the transaction.");
    } finally {
      setBusy(false);
    }
  }

  async function approveAndBroadcast() {
    if (!escrow || !prepared) return;
    setBusy(true);
    setMessage("Confirm the matching passkey…");
    let prfOutput: Uint8Array | null = null;
    try {
      const role = prepared.review.requiredRole;
      const context = roleContext(escrow, role);
      const key = role === "buyer" ? buyerCredentialKey : sellerCredentialKey;
      const result = await readEscrowPasskeyPrf(context, sessionRead(key) || undefined);
      prfOutput = result.output;
      const expectedPublicKey = role === "buyer" ? escrow.buyerPublicKey : escrow.sellerPublicKey;
      if (!expectedPublicKey) throw new Error("The required signer is not connected.");
      const signed = await signPreparedEscrowCanary({
        context,
        expectedPublicKey,
        prepared,
        prfOutput,
      });
      sessionWrite(key, result.credentialId);
      const response = await fetch(`/api/escrows/${publicId}`, {
        body: JSON.stringify({
          action: "broadcast",
          mode: prepared.review.mode,
          transactionSafeJson: signed.transactionSafeJson,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      await parseResponse(response);
      setPrepared(null);
      setMessage("Transaction submitted to Kaspa Mainnet.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The transaction was not submitted.");
    } finally {
      prfOutput?.fill(0);
      setBusy(false);
    }
  }

  if (!escrow) {
    return (
      <main className="escrow-link-shell">
        <section className="escrow-link-card escrow-link-loading">
          <span className="escrow-link-mark">Kaspa Links</span>
          <h1>Opening private escrow…</h1>
          {message ? <p role="alert">{message}</p> : null}
        </section>
      </main>
    );
  }

  const waitingForBuyer = !escrow.buyerPublicKey;
  const funded = escrow.funding.state === "funded";
  const remainingMinutes =
    escrow.releaseAfter && escrow.chainDaa
      ? Math.max(1, Math.ceil((Number(escrow.releaseAfter) - Number(escrow.chainDaa)) / 600))
      : null;

  return (
    <main className="escrow-link-shell">
      <section className="escrow-link-hero">
        <span className="escrow-link-private">Private escrow</span>
        <span className="escrow-link-kicker">SilverScript · Mainnet</span>
        <h1>{escrow.title}</h1>
        <p>Created by @{escrow.creatorUsername}</p>
        <div className="escrow-link-amount">
          <span>Escrow value</span>
          <strong>0.21 KAS</strong>
          <small>0.01 KAS network fee</small>
        </div>
      </section>

      <ol className="escrow-link-progress" aria-label="Escrow progress">
        <li className={!waitingForBuyer ? "done" : "active"}>
          <span>1</span>Accept
        </li>
        <li className={funded || escrow.submitted ? "done" : !waitingForBuyer ? "active" : ""}>
          <span>2</span>Fund
        </li>
        <li className={escrow.submitted ? "done" : funded ? "active" : ""}>
          <span>3</span>Resolve
        </li>
      </ol>

      {waitingForBuyer ? (
        <section className="escrow-link-card">
          <span className="escrow-link-step">Step 1</span>
          <h2>Accept as buyer</h2>
          <p>
            Your address receives an immediate refund if the seller cancels. The first buyer to
            accept locks this link.
          </p>
          <label>
            Your Kaspium receive address
            <input
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setBuyerAddress(event.target.value)}
              placeholder="kaspa:…"
              spellCheck={false}
              value={buyerAddress}
            />
          </label>
          <button
            className="btn btn-primary escrow-link-primary"
            disabled={busy || !buyerAddress.trim()}
            onClick={() => void join(true)}
            type="button"
          >
            {busy ? "Connecting…" : "Create passkey & accept"}
          </button>
          <button
            className="escrow-link-text-button"
            disabled={busy || !buyerAddress.trim()}
            onClick={() => void join(false)}
            type="button"
          >
            Use an existing passkey
          </button>
          <p className="escrow-link-safety">
            Your passkey secret stays on this device or in your passkey provider.
          </p>
        </section>
      ) : null}

      {!waitingForBuyer &&
      !escrow.submitted &&
      escrow.funding.state === "awaiting_funding" &&
      escrow.activeFundingAddress ? (
        <section className="escrow-link-card">
          <span className="escrow-link-step">Step 2</span>
          <h2>Fund the escrow</h2>
          <p>
            Send exactly <strong>0.22 KAS</strong>. The contract pays 0.21 KAS and reserves 0.01 KAS
            for the final transaction.
          </p>
          <div className="escrow-link-funding">
            <FundingQrCode
              ariaLabel="Fund this escrow with exactly 0.22 KAS"
              paymentUri={paymentUri}
            />
            <code>{escrow.activeFundingAddress}</code>
          </div>
          <a className="btn btn-primary escrow-link-primary" href={paymentUri}>
            Open Kaspium
          </a>
          <button
            className="btn escrow-link-primary"
            onClick={() => void navigator.clipboard.writeText(escrow.activeFundingAddress!)}
            type="button"
          >
            Copy address
          </button>
          <p className="escrow-link-safety">
            Waiting for one exact 0.22 KAS output · refreshes automatically
          </p>
        </section>
      ) : null}

      {!escrow.submitted && escrow.funding.state === "ambiguous" ? (
        <section className="escrow-link-card escrow-link-warning">
          <h2>Review required</h2>
          <p>More than one exact funding output was found. Do not send more KAS.</p>
        </section>
      ) : null}

      {!escrow.submitted && funded ? (
        <section className="escrow-link-card">
          <span className="escrow-link-step">Step 3</span>
          <h2>Choose the outcome</h2>
          <div className="escrow-link-actions">
            <button disabled={busy} onClick={() => void prepare("release")} type="button">
              <strong>Buyer releases</strong>
              <span>0.21 KAS to the seller</span>
            </button>
            <button disabled={busy} onClick={() => void prepare("refund")} type="button">
              <strong>Seller refunds</strong>
              <span>0.21 KAS to the buyer now</span>
            </button>
            <button
              disabled={busy || !escrow.claimAvailable}
              onClick={() => void prepare("claim")}
              type="button"
            >
              <strong>Seller claims</strong>
              <span>
                {escrow.claimAvailable
                  ? "Deadline reached"
                  : `Available in about ${remainingMinutes} min`}
              </span>
            </button>
          </div>
        </section>
      ) : null}

      {prepared ? (
        <section className="escrow-link-card escrow-link-review">
          <span className="escrow-link-step">Final check</span>
          <h2>
            {prepared.review.mode === "release"
              ? "Release to seller"
              : prepared.review.mode === "refund"
                ? "Refund to buyer"
                : "Claim after deadline"}
          </h2>
          <dl>
            <div>
              <dt>Recipient</dt>
              <dd>{prepared.review.destinationAddress}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>0.21 KAS</dd>
            </div>
            <div>
              <dt>Signer</dt>
              <dd>{prepared.review.requiredRole}</dd>
            </div>
          </dl>
          <button
            className="btn btn-primary escrow-link-primary"
            disabled={busy}
            onClick={() => void approveAndBroadcast()}
            type="button"
          >
            {busy ? "Signing…" : "Approve with passkey"}
          </button>
          <button
            className="escrow-link-text-button"
            disabled={busy}
            onClick={() => setPrepared(null)}
            type="button"
          >
            Cancel
          </button>
        </section>
      ) : null}

      {escrow.submitted ? (
        <section className="escrow-link-card escrow-link-receipt">
          <span className="escrow-link-check">✓</span>
          <h2>Escrow completed</h2>
          <p>
            {escrow.submitted.mode === "refund"
              ? "The refund was submitted to the buyer."
              : "The payment was submitted to the seller."}
          </p>
          <code>{escrow.submitted.transactionId}</code>
          <a
            className="btn btn-primary escrow-link-primary"
            href={`https://explorer.kaspa.org/txs/${escrow.submitted.transactionId}`}
            rel="noreferrer"
            target="_blank"
          >
            View on Kaspa Explorer
          </a>
        </section>
      ) : null}

      {message ? (
        <p className="escrow-link-message" role="status">
          {message}
        </p>
      ) : null}
      <footer>Non-custodial · Passkey signed · Verified by Kaspa consensus</footer>
    </main>
  );
}
