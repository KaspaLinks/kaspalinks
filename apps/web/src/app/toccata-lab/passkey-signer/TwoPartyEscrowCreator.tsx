"use client";

import { useCallback, useEffect, useState } from "react";

import { readEscrowPasskeyPrf } from "@/lib/escrow-passkey-browser";
import {
  deriveEscrowSignerPublicIdentity,
  type EscrowSignerContext,
} from "@/lib/escrow-passkey-signer";

type CreatorEscrow = {
  createdAt: string;
  publicId: string;
  sharePath: string;
  status: string;
  title: string;
};

type Props = {
  creatorHeaders: Record<string, string>;
  credentialId: string;
  passkeyVerified: boolean;
  signedIn: boolean;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Escrow request failed.");
  return body;
}

export function TwoPartyEscrowCreator({
  creatorHeaders,
  credentialId,
  passkeyVerified,
  signedIn,
}: Props) {
  const [title, setTitle] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [durationDaa, setDurationDaa] = useState("216000");
  const [items, setItems] = useState<CreatorEscrow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<"details" | "review" | "share">("details");
  const [created, setCreated] = useState<CreatorEscrow | null>(null);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const response = await fetch("/api/toccata-lab/escrow-links", {
        cache: "no-store",
        headers: creatorHeaders,
      });
      const body = await parseResponse<{ escrows: CreatorEscrow[] }>(response);
      setItems(body.escrows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load escrow links.");
    }
  }, [creatorHeaders, signedIn]);

  useEffect(() => void load(), [load]);

  async function create() {
    if (!passkeyVerified || !credentialId || !title.trim() || !sellerAddress.trim()) return;
    setBusy(true);
    setMessage("Approve the seller passkey prompt…");
    let prfOutput: Uint8Array | null = null;
    try {
      const signerContextId = `escrow-${crypto.randomUUID()}`;
      const context: EscrowSignerContext = {
        escrowId: signerContextId,
        network: "mainnet",
        role: "seller",
        signerVersion: 1,
      };
      const result = await readEscrowPasskeyPrf(context, credentialId);
      prfOutput = result.output;
      const seller = await deriveEscrowSignerPublicIdentity(prfOutput, context);
      const response = await fetch("/api/toccata-lab/escrow-links", {
        body: JSON.stringify({
          durationDaa,
          sellerAddress: sellerAddress.trim(),
          sellerPublicKey: seller.publicKey,
          signerContextId,
          title: title.trim(),
        }),
        headers: creatorHeaders,
        method: "POST",
      });
      const body = await parseResponse<{ escrow: CreatorEscrow }>(response);
      try {
        sessionStorage.setItem(
          `kaspalinks:escrow:${body.escrow.publicId}:seller-credential`,
          result.credentialId,
        );
      } catch {
        /* The discoverable passkey remains selectable without this hint. */
      }
      setItems((current) => [body.escrow, ...current]);
      setCreated(body.escrow);
      setStep("share");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the escrow link.");
    } finally {
      prfOutput?.fill(0);
      setBusy(false);
    }
  }

  function absoluteUrl(path: string) {
    return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  }

  async function copyLink(path: string) {
    try {
      await navigator.clipboard.writeText(absoluteUrl(path));
      setMessage("Link copied. Send it only to the intended buyer.");
    } catch {
      setMessage("Could not copy automatically. Open the link and copy its address.");
    }
  }

  const durationLabel =
    durationDaa === "36000" ? "1 hour" : durationDaa === "216000" ? "6 hours" : "24 hours";

  return (
    <section className="card passkey-escrow-studio" aria-labelledby="two-party-escrow-heading">
      <div className="passkey-escrow-intro">
        <span className="label">SilverScript escrow · Mainnet beta</span>
        <h2 id="two-party-escrow-heading">Create a private deal</h2>
        <p>Set the terms, check the payout address, then share one link with your buyer.</p>
      </div>
      <ol className="passkey-escrow-steps" aria-label="Create escrow steps">
        {(["Deal", "Review", "Share"] as const).map((name, index) => {
          const activeIndex = step === "details" ? 0 : step === "review" ? 1 : 2;
          return (
            <li
              aria-current={activeIndex === index ? "step" : undefined}
              className={index < activeIndex ? "done" : index === activeIndex ? "active" : ""}
              key={name}
            >
              <span>{index < activeIndex ? "✓" : index + 1}</span>
              {name}
            </li>
          );
        })}
      </ol>

      {step === "details" ? (
        <div className="passkey-link-form">
          <label>
            Deal title
            <input
              disabled={busy}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Logo design delivery"
              value={title}
            />
          </label>
          <label>
            Your Kaspa Mainnet payout address
            <input
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setSellerAddress(event.target.value)}
              placeholder="kaspa:…"
              spellCheck={false}
              value={sellerAddress}
            />
            <small>Any Kaspa Mainnet wallet you control.</small>
          </label>
          <label>
            Seller claim deadline
            <select
              disabled={busy}
              onChange={(event) => setDurationDaa(event.target.value)}
              value={durationDaa}
            >
              <option value="36000">1 hour after buyer accepts</option>
              <option value="216000">6 hours after buyer accepts</option>
              <option value="864000">24 hours after buyer accepts</option>
            </select>
            <small>The deadline starts when the buyer accepts, before funding.</small>
          </label>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              !passkeyVerified ||
              !signedIn ||
              title.trim().length < 3 ||
              !sellerAddress.trim()
            }
            onClick={() => {
              setMessage("");
              setStep("review");
            }}
            type="button"
          >
            Review deal →
          </button>
          {!passkeyVerified ? (
            <p className="notice">Complete the seller passkey check above to create a link.</p>
          ) : null}
        </div>
      ) : null}

      {step === "review" ? (
        <div className="passkey-escrow-review">
          <h3>Check before creating</h3>
          <dl>
            <div>
              <dt>Deal</dt>
              <dd>{title.trim()}</dd>
            </div>
            <div>
              <dt>Buyer sends</dt>
              <dd>0.22 KAS</dd>
            </div>
            <div>
              <dt>Payment or refund</dt>
              <dd>0.21 KAS</dd>
            </div>
            <div>
              <dt>Final transaction fee reserve</dt>
              <dd>0.01 KAS</dd>
            </div>
            <div>
              <dt>Seller claim</dt>
              <dd>After {durationLabel} from buyer acceptance</dd>
            </div>
            <div>
              <dt>Your payout address</dt>
              <dd>{sellerAddress.trim()}</dd>
            </div>
          </dl>
          <p>
            The buyer adds a refund address and passkey before funding. The seller can claim after
            the deadline without the buyer signing.
          </p>
          <div className="passkey-escrow-buttons">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setStep("details")}
              type="button"
            >
              Edit terms
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !passkeyVerified || !signedIn}
              onClick={() => void create()}
              type="button"
            >
              {busy ? "Creating…" : "Confirm with seller passkey"}
            </button>
          </div>
        </div>
      ) : null}

      {step === "share" && created ? (
        <div className="passkey-escrow-share" role="status">
          <span className="passkey-escrow-success" aria-hidden="true">
            ✓
          </span>
          <h3>Private link ready</h3>
          <p>Share this link only with your buyer. They can accept and fund the escrow there.</p>
          <code>{absoluteUrl(created.sharePath)}</code>
          <div className="passkey-escrow-buttons">
            <button
              className="btn btn-primary"
              onClick={() => void copyLink(created.sharePath)}
              type="button"
            >
              Copy buyer link
            </button>
            <a className="btn" href={created.sharePath} rel="noreferrer" target="_blank">
              Open deal
            </a>
          </div>
          <button
            className="passkey-escrow-again"
            onClick={() => {
              setCreated(null);
              setTitle("");
              setSellerAddress("");
              setStep("details");
              setMessage("");
            }}
            type="button"
          >
            Create another deal
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {items.length > 0 ? (
        <details className="passkey-link-list">
          <summary>Your escrow links ({items.length})</summary>
          {items.map((item) => (
            <article key={item.publicId}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.status.replaceAll("_", " ")}</span>
              </div>
              <div className="row">
                <a className="btn" href={item.sharePath} target="_blank" rel="noreferrer">
                  Open
                </a>
                <button className="btn" onClick={() => void copyLink(item.sharePath)} type="button">
                  Copy link
                </button>
              </div>
            </article>
          ))}
        </details>
      ) : null}
    </section>
  );
}
