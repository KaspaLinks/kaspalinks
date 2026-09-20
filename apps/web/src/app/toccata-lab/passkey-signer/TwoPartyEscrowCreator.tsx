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
      setTitle("");
      setMessage("Private escrow link created. Share it only with the intended buyer.");
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

  return (
    <section className="card passkey-lab-step" aria-labelledby="two-party-escrow-heading">
      <div className="passkey-lab-number">4</div>
      <div>
        <span className="label">Two-party beta · real KAS</span>
        <h2 id="two-party-escrow-heading">Create a private escrow link</h2>
        <p>
          Add the deal and your payout address. The buyer opens the link, adds a refund address and
          binds their own passkey before funding becomes possible.
        </p>
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
            Your Kaspium payout address
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
          </label>
          <button
            className="btn btn-primary"
            disabled={
              busy || !passkeyVerified || !signedIn || !title.trim() || !sellerAddress.trim()
            }
            onClick={() => void create()}
            type="button"
          >
            {busy ? "Creating…" : "Create private link"}
          </button>
        </div>
        {!passkeyVerified ? (
          <p className="notice">Complete passkey step 1 before creating a link.</p>
        ) : null}
        {message ? (
          <p className="notice" role="status">
            {message}
          </p>
        ) : null}
        {items.length > 0 ? (
          <div className="passkey-link-list">
            <h3>Your recent escrow links</h3>
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
                  <button
                    className="btn"
                    onClick={() => void navigator.clipboard.writeText(absoluteUrl(item.sharePath))}
                    type="button"
                  >
                    Copy link
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
