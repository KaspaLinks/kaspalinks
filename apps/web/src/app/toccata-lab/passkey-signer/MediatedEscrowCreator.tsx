"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createEscrowPasskey,
  escrowPasskeySupported,
  readEscrowPasskeyPrf,
} from "@/lib/escrow-passkey-browser";
import {
  deriveEscrowSignerPublicIdentity,
  type EscrowSignerContext,
} from "@/lib/escrow-passkey-signer";

type CreatorEscrow = {
  createdAt: string;
  mediatorLabel: string;
  publicId: string;
  sharePath: string;
  status: string;
  title: string;
};

type Props = {
  creatorHeaders: Record<string, string>;
  credentialId?: string;
  signedIn: boolean;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Escrow request failed.");
  return body;
}

export function MediatedEscrowCreator({ creatorHeaders, credentialId = "", signedIn }: Props) {
  const [title, setTitle] = useState("");
  const [sellerAddress, setSellerAddress] = useState("");
  const [mediatorLabel, setMediatorLabel] = useState("");
  const [claimDelayDaa, setClaimDelayDaa] = useState("6048000");
  const [items, setItems] = useState<CreatorEscrow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<"details" | "review" | "share">("details");
  const [created, setCreated] = useState<CreatorEscrow | null>(null);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const response = await fetch("/api/toccata-lab/mediated-escrows", {
        cache: "no-store",
        headers: creatorHeaders,
      });
      const body = await parseResponse<{ escrows: CreatorEscrow[] }>(response);
      setItems(body.escrows);
      setCreated((current) =>
        current
          ? (body.escrows.find((item) => item.publicId === current.publicId) ?? current)
          : null,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load escrow links.");
    }
  }, [creatorHeaders, signedIn]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function create(createNewPasskey: boolean) {
    if (!title.trim() || !sellerAddress.trim() || !mediatorLabel.trim()) {
      return;
    }
    if (!escrowPasskeySupported()) {
      setMessage("Open Kaspa Links directly in Safari or Chrome to use a passkey.");
      return;
    }
    setBusy(true);
    setMessage(createNewPasskey ? "Creating your seller passkey…" : "Select your seller passkey…");
    let prfOutput: Uint8Array | null = null;
    try {
      const signerContextId = `escrow-v2-${crypto.randomUUID()}`;
      const context: EscrowSignerContext = {
        escrowId: signerContextId,
        network: "mainnet",
        role: "seller",
        signerVersion: 1,
      };
      const credentialHint = createNewPasskey
        ? await createEscrowPasskey(context, `Seller · ${title.trim()}`)
        : credentialId || undefined;
      const result = await readEscrowPasskeyPrf(context, credentialHint);
      prfOutput = result.output;
      const seller = await deriveEscrowSignerPublicIdentity(prfOutput, context);
      const response = await fetch("/api/toccata-lab/mediated-escrows", {
        body: JSON.stringify({
          claimDelayDaa,
          mediatorLabel: mediatorLabel.trim(),
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
          `kaspalinks:escrow-v2:${body.escrow.publicId}:seller-credential`,
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
      setMessage(error instanceof Error ? error.message : "Could not create the escrow.");
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
      setMessage("Link copied.");
    } catch {
      setMessage("Open the deal and copy its address.");
    }
  }

  const claimLabel =
    claimDelayDaa === "6048000" ? "7 days" : claimDelayDaa === "12096000" ? "14 days" : "30 days";

  return (
    <section className="card passkey-escrow-studio" aria-labelledby="mediated-escrow-heading">
      <div className="passkey-escrow-intro">
        <span className="label">SilverScript escrow V2 · Mainnet lab</span>
        <h2 id="mediated-escrow-heading">Create a protected deal</h2>
        <p>Seller, buyer and an independent mediator each use their own passkey.</p>
      </div>
      <ol className="passkey-escrow-steps" aria-label="Create mediated escrow steps">
        {["Deal", "Rules", "Invite"].map((name, index) => {
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
              placeholder="e.g. Used iPhone"
              value={title}
            />
          </label>
          <label>
            Your Kaspa payout address
            <input
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setSellerAddress(event.target.value)}
              placeholder="kaspa:…"
              spellCheck={false}
              value={sellerAddress}
            />
          </label>
          <label>
            Independent mediator
            <input
              disabled={busy}
              maxLength={60}
              onChange={(event) => setMediatorLabel(event.target.value)}
              placeholder="Name agreed with the buyer"
              value={mediatorLabel}
            />
            <small>
              Agree on this person separately. The first person who accepts the invite locks the
              mediator key.
            </small>
          </label>
          <label>
            Buyer inspection window
            <select
              disabled={busy}
              onChange={(event) => setClaimDelayDaa(event.target.value)}
              value={claimDelayDaa}
            >
              <option value="6048000">7 days after funding</option>
              <option value="12096000">14 days after funding</option>
              <option value="25920000">30 days after funding</option>
            </select>
          </label>
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              !signedIn ||
              title.trim().length < 3 ||
              mediatorLabel.trim().length < 2 ||
              !sellerAddress.trim()
            }
            onClick={() => setStep("review")}
            type="button"
          >
            Review rules →
          </button>
        </div>
      ) : null}

      {step === "review" ? (
        <div className="passkey-escrow-review">
          <h3>Rules fixed before funding</h3>
          <dl>
            <div>
              <dt>Buyer funds</dt>
              <dd>0.22 KAS</dd>
            </div>
            <div>
              <dt>Normal payment or refund</dt>
              <dd>0.21 KAS</dd>
            </div>
            <div>
              <dt>Inspection</dt>
              <dd>{claimLabel} after the funding output confirms</dd>
            </div>
            <div>
              <dt>If buyer freezes</dt>
              <dd>Buyer + seller can agree, or {mediatorLabel.trim()} decides with the winner</dd>
            </div>
            <div>
              <dt>If nobody resolves the dispute</dt>
              <dd>0.20 KAS to seller after 30 days in frozen state</dd>
            </div>
          </dl>
          <p>
            The mediator cannot move funds alone and can pay only the fixed buyer or seller address.
          </p>
          <div className="passkey-escrow-buttons">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setStep("details")}
              type="button"
            >
              Edit
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !signedIn}
              onClick={() => void create(!credentialId)}
              type="button"
            >
              {busy
                ? "Creating…"
                : credentialId
                  ? "Confirm with seller passkey"
                  : "Create seller passkey & link"}
            </button>
          </div>
          <button
            className="passkey-escrow-again"
            disabled={busy || !signedIn}
            onClick={() => void create(Boolean(credentialId))}
            type="button"
          >
            {credentialId ? "Create a different seller passkey" : "Use an existing passkey"}
          </button>
        </div>
      ) : null}

      {step === "share" && created ? (
        <div className="passkey-escrow-share" role="status">
          <span className="passkey-escrow-success" aria-hidden="true">
            {created.status === "awaiting_mediator" ? "1" : "✓"}
          </span>
          <h3>
            {created.status === "awaiting_mediator"
              ? `Invite ${created.mediatorLabel} first`
              : "Mediator connected · send to buyer"}
          </h3>
          <p>
            {created.status === "awaiting_mediator"
              ? "The funding address does not exist until the mediator and buyer have both joined."
              : "The same link is now ready for the buyer."}
          </p>
          <code>{absoluteUrl(created.sharePath)}</code>
          <div className="passkey-escrow-buttons">
            <button
              className="btn btn-primary"
              onClick={() => void copyLink(created.sharePath)}
              type="button"
            >
              Copy invite link
            </button>
            <a className="btn" href={created.sharePath} rel="noreferrer" target="_blank">
              Open deal
            </a>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {items.length > 0 ? (
        <details className="passkey-link-list">
          <summary>Your mediated escrows ({items.length})</summary>
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
