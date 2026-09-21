"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa/amount";

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
import { escrowLinkStage } from "./escrow-link-stage";

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
  const [selectedRole, setSelectedRole] = useState<"buyer" | "seller" | null>(null);
  const [copyMessage, setCopyMessage] = useState("");

  const buyerCredentialKey = `kaspalinks:escrow:${publicId}:buyer-credential`;
  const sellerCredentialKey = `kaspalinks:escrow:${publicId}:seller-credential`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/escrows/${publicId}`, { cache: "no-store" });
      const body = await parseResponse<{ escrow: PublicEscrow }>(response);
      setEscrow(body.escrow);
      if (escrowLinkStage(body.escrow) !== "resolve") setPrepared(null);
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
      amountKas: formatSompiToKaspa(escrow.fundingAmountSompi),
      recipientAddress: escrow.activeFundingAddress,
    });
  }, [escrow?.activeFundingAddress, escrow?.fundingAmountSompi]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(`${label} copied.`);
    } catch {
      setCopyMessage("Copy failed. Select and copy the text manually.");
    }
  }

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

  const stage = escrowLinkStage(escrow);
  const payoutKas = formatSompiToKaspa(escrow.amountSompi);
  const fundingKas = formatSompiToKaspa(escrow.fundingAmountSompi);
  const feeKas = formatSompiToKaspa(escrow.feeSompi);
  const remainingMinutes =
    escrow.releaseAfter && escrow.chainDaa
      ? Math.max(0, Math.ceil((Number(escrow.releaseAfter) - Number(escrow.chainDaa)) / 600))
      : null;
  const durationHours = Number(escrow.durationDaa) / 36_000;
  const currentStep = stage === "accept" ? 1 : stage === "fund" ? 2 : 3;
  const actions =
    selectedRole === "buyer"
      ? [
          {
            mode: "release" as const,
            title: "Release payment",
            hint: `${payoutKas} KAS to the seller`,
          },
        ]
      : selectedRole === "seller"
        ? [
            {
              mode: "refund" as const,
              title: "Refund buyer",
              hint: `${payoutKas} KAS back to the buyer`,
            },
            {
              mode: "claim" as const,
              title: "Claim after deadline",
              hint: escrow.claimAvailable
                ? "Deadline reached · available now"
                : `Available in about ${remainingMinutes ?? "…"} min`,
            },
          ]
        : [];

  return (
    <main className="escrow-link-shell">
      <section className="escrow-link-hero">
        <div className="escrow-link-hero-top">
          <span className="escrow-link-brand">
            Kaspa <b>Links</b>
          </span>
          <span className="escrow-link-private">Private beta · Mainnet</span>
        </div>
        <span className="escrow-link-kicker">A deal protected by SilverScript</span>
        <h1>{escrow.title}</h1>
        <p>Created by @{escrow.creatorUsername} · Buyer and seller keep control</p>
        <div className="escrow-link-amount">
          <div>
            <span>Payment</span>
            <strong>
              {payoutKas} <small>KAS</small>
            </strong>
          </div>
          <div>
            <span>Buyer sends</span>
            <strong>
              {fundingKas} <small>KAS</small>
            </strong>
          </div>
        </div>
      </section>

      <ol className="escrow-link-progress" aria-label="Escrow progress">
        {["Accept", "Fund", "Finish"].map((label, index) => (
          <li
            aria-current={currentStep === index + 1 && stage !== "submitted" ? "step" : undefined}
            className={
              stage === "submitted" || currentStep > index + 1
                ? "done"
                : currentStep === index + 1
                  ? "active"
                  : ""
            }
            key={label}
          >
            <span>{stage === "submitted" || currentStep > index + 1 ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {stage === "accept" ? (
        <section className="escrow-link-card" aria-labelledby="escrow-accept-title">
          <span className="escrow-link-step">01 / Accept the deal</span>
          <h2 id="escrow-accept-title">Before you pay</h2>
          <p>
            Check the deal with the seller. The first buyer who accepts locks the refund address and
            buyer passkey for this link.
          </p>
          <div className="escrow-link-summary">
            <div>
              <span>Buyer sends</span>
              <strong>{fundingKas} KAS</strong>
            </div>
            <div>
              <span>Seller receives / buyer gets back</span>
              <strong>{payoutKas} KAS</strong>
            </div>
            <div>
              <span>Seller claim becomes available</span>
              <strong>About {durationHours} hours after acceptance</strong>
            </div>
          </div>
          <label htmlFor="escrow-buyer-address">Your Kaspa Mainnet refund address</label>
          <p className="escrow-link-field-help">
            Any wallet you control. This is where a refund would go.
          </p>
          <input
            autoComplete="off"
            disabled={busy}
            id="escrow-buyer-address"
            onChange={(event) => setBuyerAddress(event.target.value)}
            placeholder="kaspa:…"
            spellCheck={false}
            value={buyerAddress}
          />
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
            Already have a buyer passkey? Use it
          </button>
          <p className="escrow-link-safety">
            Your passkey signs later in your browser. No payment is made when you accept.
          </p>
        </section>
      ) : null}

      {stage === "fund" && escrow.activeFundingAddress ? (
        <section className="escrow-link-card" aria-labelledby="escrow-fund-title">
          <span className="escrow-link-step">02 / Fund the deal</span>
          <h2 id="escrow-fund-title">Send exactly {fundingKas} KAS</h2>
          <p>
            Scan with a Kaspa wallet or copy the address. You can pay from a different wallet than
            your refund address.
          </p>
          <div className="escrow-link-funding">
            <div className="escrow-link-qr">
              <FundingQrCode
                ariaLabel={`Fund this escrow with exactly ${fundingKas} KAS`}
                paymentUri={paymentUri}
              />
            </div>
            <div className="escrow-link-funding-detail">
              <span className="escrow-link-kicker">One exact payment</span>
              <strong>{fundingKas} KAS</strong>
              <code>{escrow.activeFundingAddress}</code>
            </div>
          </div>
          <div className="escrow-link-button-row">
            <a className="btn btn-primary escrow-link-primary" href={paymentUri}>
              Open wallet
            </a>
            <button
              className="btn escrow-link-primary"
              onClick={() => void copy(escrow.activeFundingAddress!, "Address")}
              type="button"
            >
              Copy address
            </button>
          </div>
          <p className="escrow-link-safety">
            Waiting for an exact {fundingKas} KAS output · status updates automatically. Check the
            amount in your wallet before sending.
          </p>
        </section>
      ) : null}

      {stage === "funding_expired" ? (
        <section className="escrow-link-card escrow-link-warning" role="status">
          <span className="escrow-link-step">02 / Funding closed</span>
          <h2>Do not send KAS to this address</h2>
          <p>
            The seller claim deadline was fixed when the buyer accepted and has passed before an
            exact payment was detected. Ask the seller for a new link.
          </p>
        </section>
      ) : null}

      {stage === "funding_review" ? (
        <section className="escrow-link-card escrow-link-warning" role="status">
          <span className="escrow-link-step">02 / Funding needs review</span>
          <h2>Do not send more KAS</h2>
          <p>
            More than one exact funding output was found. This page cannot safely select one for
            signing.
          </p>
        </section>
      ) : null}

      {stage === "resolve" && !prepared ? (
        <section className="escrow-link-card" aria-labelledby="escrow-resolve-title">
          <span className="escrow-link-step">03 / Finish the deal</span>
          <h2 id="escrow-resolve-title">Payment detected</h2>
          <p>Select your role to see the actions that your passkey can sign.</p>
          <div
            className="escrow-link-role-picker"
            role="group"
            aria-label="Your role in this escrow"
          >
            <button
              aria-pressed={selectedRole === "buyer"}
              className={selectedRole === "buyer" ? "selected" : ""}
              onClick={() => setSelectedRole("buyer")}
              type="button"
            >
              I am the buyer
            </button>
            <button
              aria-pressed={selectedRole === "seller"}
              className={selectedRole === "seller" ? "selected" : ""}
              onClick={() => setSelectedRole("seller")}
              type="button"
            >
              I am the seller
            </button>
          </div>
          {selectedRole ? (
            <div className="escrow-link-actions">
              {actions.map((action) => (
                <button
                  disabled={busy || (action.mode === "claim" && !escrow.claimAvailable)}
                  key={action.mode}
                  onClick={() => void prepare(action.mode)}
                  type="button"
                >
                  <strong>
                    {action.title} <span aria-hidden="true">↗</span>
                  </strong>
                  <small>{action.hint}</small>
                </button>
              ))}
            </div>
          ) : null}
          <p className="escrow-link-safety">
            The buyer can release; the seller can refund or claim after the deadline. Each action
            requires the matching passkey.
          </p>
        </section>
      ) : null}

      {prepared ? (
        <section
          className="escrow-link-card escrow-link-review"
          aria-labelledby="escrow-review-title"
        >
          <span className="escrow-link-step">03 / Check before signing</span>
          <h2 id="escrow-review-title">
            {prepared.review.mode === "release"
              ? "Release to seller"
              : prepared.review.mode === "refund"
                ? "Refund to buyer"
                : "Claim after deadline"}
          </h2>
          <p>
            Review the recipient and amount. Your passkey confirmation signs and submits a real
            Mainnet transaction.
          </p>
          <dl>
            <div>
              <dt>Recipient</dt>
              <dd>{prepared.review.destinationAddress}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{payoutKas} KAS</dd>
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
            {busy ? "Signing…" : "Sign & submit transaction"}
          </button>
          <button
            className="escrow-link-text-button"
            disabled={busy}
            onClick={() => setPrepared(null)}
            type="button"
          >
            Back to actions
          </button>
        </section>
      ) : null}

      {escrow.submitted ? (
        <section className="escrow-link-card escrow-link-receipt">
          <span className="escrow-link-check">✓</span>
          <span className="escrow-link-step">Transaction submitted</span>
          <h2>Sent to Kaspa Mainnet</h2>
          <p>
            {escrow.submitted.mode === "refund"
              ? "The buyer refund was submitted."
              : "The seller payment was submitted."}{" "}
            Check its confirmation in the explorer.
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
      {copyMessage ? (
        <p className="escrow-link-message" role="status">
          {copyMessage}
        </p>
      ) : null}
      <details className="escrow-link-details">
        <summary>Deal terms & on-chain details</summary>
        <dl>
          <div>
            <dt>Buyer sends</dt>
            <dd>{fundingKas} KAS</dd>
          </div>
          <div>
            <dt>Payment or refund</dt>
            <dd>{payoutKas} KAS</dd>
          </div>
          <div>
            <dt>Reserved for final transaction</dt>
            <dd>{feeKas} KAS</dd>
          </div>
          <div>
            <dt>Seller payout address</dt>
            <dd>{escrow.sellerAddress}</dd>
          </div>
          {escrow.buyerAddress ? (
            <div>
              <dt>Buyer refund address</dt>
              <dd>{escrow.buyerAddress}</dd>
            </div>
          ) : null}
          {escrow.releaseAfter ? (
            <div>
              <dt>Claim deadline (DAA score)</dt>
              <dd>{escrow.releaseAfter}</dd>
            </div>
          ) : null}
        </dl>
        <p>
          The seller can claim after the committed deadline without buyer approval, even if the
          buyer has not released. Kaspa Links does not arbitrate disputes.
        </p>
      </details>
      <footer>Non-custodial · SilverScript · Kaspa Mainnet</footer>
    </main>
  );
}
