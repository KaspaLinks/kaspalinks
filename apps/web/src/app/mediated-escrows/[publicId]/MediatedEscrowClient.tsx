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
  signPreparedMediatedEscrow,
  type PreparedMediatedEscrow,
} from "../../toccata-lab/passkey-signer/mediated-escrow-browser";

type Role = "buyer" | "mediator" | "seller";
type Mode = PreparedMediatedEscrow["review"]["mode"];

type PublicEscrow = {
  activeFundingAddress: null | string;
  amountSompi: string;
  buyerAddress: null | string;
  buyerPublicKey: null | string;
  chainDaa: null | string;
  claimAvailable: boolean;
  claimDelayDaa: string;
  contractTemplateHash: string;
  creatorUsername: string;
  fallbackAvailable: boolean;
  fallbackDelayDaa: string;
  feeSompi: string;
  frozenFundingAddress: null | string;
  frozenPayoutSompi: string;
  funding: {
    active: "ambiguous" | "awaiting_funding" | "funded" | "not_ready";
    frozen: "ambiguous" | "awaiting_funding" | "funded" | "not_ready";
    unexpectedOutputCount: number;
  };
  fundingAmountSompi: string;
  mediatorLabel: string;
  mediatorPublicKey: null | string;
  pendingProposal: null | {
    buyerShareSompi: null | string;
    createdAt: string;
    filledRoles: Role[];
    mediatorParty: null | "buyer" | "seller";
    mode: Mode;
    transactionSafeJson: string;
  };
  phase: "active" | "complete" | "freeze_submitted" | "frozen" | "funding" | "onboarding";
  publicId: string;
  sellerAddress: string;
  sellerPublicKey: string;
  signerContextId: string;
  status: string;
  terminal: null | { mode: Mode; transactionId: string };
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
    /* A synced discoverable passkey remains selectable. */
  }
}

function roleContext(escrow: PublicEscrow, role: Role): EscrowSignerContext {
  return { escrowId: escrow.signerContextId, network: "mainnet", role, signerVersion: 1 };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "The escrow request failed.");
  return body;
}

function kasToSompi(value: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/u.test(normalized)) {
    throw new Error("Enter a KAS amount with up to 8 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}

export function MediatedEscrowClient({ publicId }: { publicId: string }) {
  const [escrow, setEscrow] = useState<PublicEscrow | null>(null);
  const [buyerAddress, setBuyerAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [prepared, setPrepared] = useState<PreparedMediatedEscrow | null>(null);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [buyerShareKas, setBuyerShareKas] = useState("0.10");

  const credentialKey = (role: Role) => `kaspalinks:escrow-v2:${publicId}:${role}-credential`;
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/mediated-escrows/${publicId}`, { cache: "no-store" });
      const body = await parseResponse<{ escrow: PublicEscrow }>(response);
      setEscrow(body.escrow);
      if (body.escrow.phase === "complete") setPrepared(null);
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

  async function join(role: "buyer" | "mediator", create: boolean) {
    if (!escrow || !escrowPasskeySupported()) {
      setMessage("Open this link directly in Safari or Chrome to create a passkey.");
      return;
    }
    if (role === "buyer" && !buyerAddress.trim()) {
      setMessage("Enter your Kaspa refund address first.");
      return;
    }
    setBusy(true);
    setMessage(create ? `Creating the ${role} passkey…` : `Select the ${role} passkey…`);
    let prfOutput: Uint8Array | null = null;
    try {
      const context = roleContext(escrow, role);
      const createdId = create
        ? await createEscrowPasskey(
            context,
            `${role === "buyer" ? "Buyer" : "Mediator"} · ${escrow.title}`,
          )
        : sessionRead(credentialKey(role));
      const result = await readEscrowPasskeyPrf(context, createdId || undefined);
      prfOutput = result.output;
      const identity = await deriveEscrowSignerPublicIdentity(prfOutput, context);
      const response = await fetch(`/api/mediated-escrows/${publicId}`, {
        body: JSON.stringify(
          role === "mediator"
            ? { action: "joinMediator", mediatorPublicKey: identity.publicKey }
            : {
                action: "joinBuyer",
                buyerAddress: buyerAddress.trim(),
                buyerPublicKey: identity.publicKey,
              },
        ),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await parseResponse<{ escrow: PublicEscrow }>(response);
      sessionWrite(credentialKey(role), result.credentialId);
      setEscrow(body.escrow);
      setMessage(
        role === "mediator"
          ? "Mediator locked in. The buyer can join now."
          : "Buyer locked in. Funding is ready.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not connect the ${role}.`);
    } finally {
      prfOutput?.fill(0);
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Funding address copied.");
    } catch {
      setMessage("Select and copy the address manually.");
    }
  }

  async function prepareAction(
    mode: Mode,
    options: { buyerShareSompi?: bigint; mediatorParty?: "buyer" | "seller" } = {},
  ) {
    setBusy(true);
    setPrepared(null);
    setMessage("Preparing the exact on-chain result…");
    try {
      const response = await fetch(`/api/mediated-escrows/${publicId}`, {
        body: JSON.stringify({
          action: "prepare",
          ...(options.buyerShareSompi !== undefined
            ? { buyerShareSompi: options.buyerShareSompi.toString() }
            : {}),
          ...(options.mediatorParty ? { mediatorParty: options.mediatorParty } : {}),
          mode,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setPrepared(await parseResponse<PreparedMediatedEscrow>(response));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare the transaction.");
    } finally {
      setBusy(false);
    }
  }

  async function openPending() {
    if (!escrow?.pendingProposal) return;
    await prepareAction(escrow.pendingProposal.mode, {
      ...(escrow.pendingProposal.buyerShareSompi !== null
        ? { buyerShareSompi: BigInt(escrow.pendingProposal.buyerShareSompi) }
        : {}),
      ...(escrow.pendingProposal.mediatorParty
        ? { mediatorParty: escrow.pendingProposal.mediatorParty }
        : {}),
    });
  }

  function rolePublicKey(current: PublicEscrow, role: Role) {
    return role === "buyer"
      ? current.buyerPublicKey
      : role === "seller"
        ? current.sellerPublicKey
        : current.mediatorPublicKey;
  }

  async function signAndSubmit() {
    if (!escrow || !prepared || !selectedRole) return;
    if (!prepared.review.requiredRoles.includes(selectedRole)) {
      setMessage("This proposal needs a different signer role.");
      return;
    }
    setBusy(true);
    setMessage(`Confirm the ${selectedRole} passkey…`);
    let prfOutput: Uint8Array | null = null;
    try {
      const context = roleContext(escrow, selectedRole);
      const result = await readEscrowPasskeyPrf(
        context,
        sessionRead(credentialKey(selectedRole)) || undefined,
      );
      prfOutput = result.output;
      const expectedPublicKey = rolePublicKey(escrow, selectedRole);
      if (!expectedPublicKey) throw new Error("This signer role has not joined the escrow.");
      const signed = await signPreparedMediatedEscrow({
        context,
        expectedPublicKey,
        prepared,
        prfOutput,
        role: selectedRole,
      });
      sessionWrite(credentialKey(selectedRole), result.credentialId);
      const response = await fetch(`/api/mediated-escrows/${publicId}`, {
        body: JSON.stringify({
          action: "saveSignature",
          ...(prepared.review.buyerShareSompi !== null
            ? { buyerShareSompi: prepared.review.buyerShareSompi }
            : {}),
          ...(prepared.review.mediatorParty
            ? { mediatorParty: prepared.review.mediatorParty }
            : {}),
          mode: prepared.review.mode,
          role: selectedRole,
          transactionSafeJson: signed.transactionSafeJson,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const resultBody = await parseResponse<{ complete: boolean; pending?: boolean }>(response);
      setPrepared(null);
      setMessage(
        resultBody.complete
          ? "Transaction submitted to Kaspa Mainnet."
          : "Your signature is saved. The second signer can finish from this link.",
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The signature was not submitted.");
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
          <h1>Opening protected deal…</h1>
          {message ? <p role="alert">{message}</p> : null}
        </section>
      </main>
    );
  }

  const paymentKas = formatSompiToKaspa(escrow.amountSompi);
  const fundingKas = formatSompiToKaspa(escrow.fundingAmountSompi);
  const frozenPayoutKas = formatSompiToKaspa(escrow.frozenPayoutSompi);
  const claimDays = Number(escrow.claimDelayDaa) / 864_000;
  const currentStep = escrow.phase === "onboarding" ? 1 : escrow.phase === "funding" ? 2 : 3;
  const pendingRoles: Role[] = escrow.pendingProposal
    ? escrow.pendingProposal.mode === "agree"
      ? ["buyer", "seller"]
      : escrow.pendingProposal.mode === "arbitrate" && escrow.pendingProposal.mediatorParty
        ? [escrow.pendingProposal.mediatorParty, "mediator"]
        : []
    : [];
  const pendingNeedsSelectedRole = Boolean(
    escrow.pendingProposal &&
    selectedRole &&
    pendingRoles.includes(selectedRole) &&
    !escrow.pendingProposal.filledRoles.includes(selectedRole),
  );

  return (
    <main className="escrow-link-shell">
      <section className="escrow-link-hero">
        <div className="escrow-link-hero-top">
          <span className="escrow-link-brand">
            Kaspa <b>Links</b>
          </span>
          <span className="escrow-link-private">Mediated beta · Mainnet</span>
        </div>
        <span className="escrow-link-kicker">SilverScript purchase escrow</span>
        <h1>{escrow.title}</h1>
        <p>
          Seller @{escrow.creatorUsername} · Mediator {escrow.mediatorLabel}
        </p>
        <div className="escrow-link-amount">
          <div>
            <span>Purchase</span>
            <strong>
              {paymentKas} <small>KAS</small>
            </strong>
          </div>
          <div>
            <span>Buyer funds</span>
            <strong>
              {fundingKas} <small>KAS</small>
            </strong>
          </div>
        </div>
      </section>

      <ol className="escrow-link-progress" aria-label="Escrow progress">
        {["Roles", "Fund", "Resolve"].map((label, index) => (
          <li
            aria-current={
              currentStep === index + 1 && escrow.phase !== "complete" ? "step" : undefined
            }
            className={
              escrow.phase === "complete" || currentStep > index + 1
                ? "done"
                : currentStep === index + 1
                  ? "active"
                  : ""
            }
            key={label}
          >
            <span>{escrow.phase === "complete" || currentStep > index + 1 ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {escrow.status === "awaiting_mediator" ? (
        <section className="escrow-link-card">
          <span className="escrow-link-step">01 / Independent mediator</span>
          <h2>{escrow.mediatorLabel}, join this deal</h2>
          <p>
            Your passkey can approve a buyer or seller award after a dispute. It cannot move funds
            alone. Confirm this deal with the seller through a separate channel before joining.
          </p>
          <button
            className="btn btn-primary escrow-link-primary"
            disabled={busy}
            onClick={() => void join("mediator", true)}
            type="button"
          >
            {busy ? "Connecting…" : "Create mediator passkey & join"}
          </button>
          <button
            className="escrow-link-text-button"
            disabled={busy}
            onClick={() => void join("mediator", false)}
            type="button"
          >
            Use existing mediator passkey
          </button>
        </section>
      ) : null}

      {escrow.status === "awaiting_buyer" ? (
        <section className="escrow-link-card">
          <span className="escrow-link-step">01 / Buyer</span>
          <h2>Mediator connected</h2>
          <p>Check the terms, then lock your refund address and buyer passkey before funding.</p>
          <div className="escrow-link-summary">
            <div>
              <span>Inspection</span>
              <strong>About {claimDays} days after funding</strong>
            </div>
            <div>
              <span>Unresolved frozen dispute</span>
              <strong>{frozenPayoutKas} KAS to seller after 30 days</strong>
            </div>
          </div>
          <label htmlFor="mediated-buyer-address">Your Kaspa refund address</label>
          <input
            id="mediated-buyer-address"
            autoComplete="off"
            disabled={busy}
            onChange={(event) => setBuyerAddress(event.target.value)}
            placeholder="kaspa:…"
            spellCheck={false}
            value={buyerAddress}
          />
          <button
            className="btn btn-primary escrow-link-primary"
            disabled={busy || !buyerAddress.trim()}
            onClick={() => void join("buyer", true)}
            type="button"
          >
            {busy ? "Connecting…" : "Create buyer passkey & accept"}
          </button>
          <button
            className="escrow-link-text-button"
            disabled={busy || !buyerAddress.trim()}
            onClick={() => void join("buyer", false)}
            type="button"
          >
            Use existing buyer passkey
          </button>
        </section>
      ) : null}

      {escrow.phase === "funding" &&
      escrow.activeFundingAddress &&
      escrow.funding.active !== "ambiguous" &&
      escrow.funding.unexpectedOutputCount === 0 ? (
        <section className="escrow-link-card">
          <span className="escrow-link-step">02 / Fund</span>
          <h2>Send exactly {fundingKas} KAS</h2>
          <p>Both parties and the mediator are committed. Check the amount in your wallet.</p>
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
              onClick={() => void copy(escrow.activeFundingAddress!)}
              type="button"
            >
              Copy address
            </button>
          </div>
        </section>
      ) : null}

      {escrow.phase === "funding" &&
      (escrow.funding.active === "ambiguous" || escrow.funding.unexpectedOutputCount > 0) ? (
        <section className="escrow-link-card escrow-link-warning" role="alert">
          <span className="escrow-link-step">Funding needs review</span>
          <h2>Do not send more KAS</h2>
          <p>
            {escrow.funding.active === "ambiguous"
              ? "More than one exact funding output was detected. No transaction will be selected automatically."
              : "A payment with the wrong amount was detected. It is not treated as a funded deal."}
          </p>
        </section>
      ) : null}

      {escrow.phase === "freeze_submitted" ? (
        <section className="escrow-link-card" role="status">
          <span className="escrow-link-step">Dispute opened</span>
          <h2>Waiting for frozen state</h2>
          <p>The freeze transaction was submitted. Actions appear after its output is confirmed.</p>
        </section>
      ) : null}

      {(escrow.phase === "active" || escrow.phase === "frozen") && !prepared ? (
        <section className="escrow-link-card">
          <span className="escrow-link-step">
            03 / {escrow.phase === "active" ? "Finish" : "Resolve dispute"}
          </span>
          <h2>{escrow.phase === "active" ? "Payment detected" : "Funds are frozen"}</h2>
          <p>Select your role. The matching passkey decides which actions you can sign.</p>
          <div
            className="escrow-link-role-picker escrow-link-role-picker-three"
            role="group"
            aria-label="Your escrow role"
          >
            {(["buyer", "seller", "mediator"] as const).map((role) => (
              <button
                aria-pressed={selectedRole === role}
                className={selectedRole === role ? "selected" : ""}
                key={role}
                onClick={() => setSelectedRole(role)}
                type="button"
              >
                {role === "buyer"
                  ? "I am the buyer"
                  : role === "seller"
                    ? "I am the seller"
                    : "I am the mediator"}
              </button>
            ))}
          </div>

          {escrow.pendingProposal ? (
            <div className="escrow-link-summary">
              <div>
                <span>Pending proposal</span>
                <strong>
                  Buyer {formatSompiToKaspa(escrow.pendingProposal.buyerShareSompi ?? "0")} KAS ·
                  Seller{" "}
                  {formatSompiToKaspa(
                    (
                      BigInt(escrow.frozenPayoutSompi) -
                      BigInt(escrow.pendingProposal.buyerShareSompi ?? "0")
                    ).toString(),
                  )}{" "}
                  KAS
                </strong>
              </div>
              <div>
                <span>Already signed</span>
                <strong>{escrow.pendingProposal.filledRoles.join(" + ")}</strong>
              </div>
              {pendingNeedsSelectedRole ? (
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void openPending()}
                  type="button"
                >
                  Review & co-sign
                </button>
              ) : null}
            </div>
          ) : null}

          {selectedRole === "buyer" && escrow.phase === "active" ? (
            <div className="escrow-link-actions">
              <button disabled={busy} onClick={() => void prepareAction("release")} type="button">
                <strong>Release payment →</strong>
                <small>{paymentKas} KAS to seller</small>
              </button>
              <button disabled={busy} onClick={() => void prepareAction("freeze")} type="button">
                <strong>Open dispute</strong>
                <small>Move funds to frozen state</small>
              </button>
            </div>
          ) : null}
          {selectedRole === "seller" && escrow.phase === "active" ? (
            <div className="escrow-link-actions">
              <button disabled={busy} onClick={() => void prepareAction("refund")} type="button">
                <strong>Refund buyer</strong>
                <small>{paymentKas} KAS to buyer</small>
              </button>
              <button
                disabled={busy || !escrow.claimAvailable}
                onClick={() => void prepareAction("claim")}
                type="button"
              >
                <strong>Claim after inspection</strong>
                <small>
                  {escrow.claimAvailable
                    ? `${paymentKas} KAS to seller`
                    : "Inspection window is still open"}
                </small>
              </button>
            </div>
          ) : null}
          {selectedRole === "seller" && escrow.phase === "frozen" ? (
            <div className="escrow-link-actions">
              <button disabled={busy} onClick={() => void prepareAction("refund")} type="button">
                <strong>Refund buyer</strong>
                <small>{frozenPayoutKas} KAS to buyer</small>
              </button>
              <button
                disabled={busy || !escrow.fallbackAvailable}
                onClick={() => void prepareAction("fallbackSeller")}
                type="button"
              >
                <strong>30-day default payout</strong>
                <small>
                  {escrow.fallbackAvailable
                    ? `${frozenPayoutKas} KAS to seller`
                    : "Available after 30 days frozen"}
                </small>
              </button>
            </div>
          ) : null}
          {(selectedRole === "buyer" || selectedRole === "seller") &&
          escrow.phase === "frozen" &&
          !escrow.pendingProposal ? (
            <div className="passkey-link-form">
              <label>
                Agreed buyer share in KAS
                <input
                  inputMode="decimal"
                  onChange={(event) => setBuyerShareKas(event.target.value)}
                  value={buyerShareKas}
                />
              </label>
              <button
                className="btn"
                disabled={busy}
                onClick={() => {
                  try {
                    void prepareAction("agree", { buyerShareSompi: kasToSompi(buyerShareKas) });
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Invalid split.");
                  }
                }}
                type="button"
              >
                Propose agreed split
              </button>
            </div>
          ) : null}
          {selectedRole === "mediator" && escrow.phase === "frozen" && !escrow.pendingProposal ? (
            <div className="escrow-link-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void prepareAction("arbitrate", {
                    buyerShareSompi: BigInt(escrow.frozenPayoutSompi),
                    mediatorParty: "buyer",
                  })
                }
                type="button"
              >
                <strong>Award buyer</strong>
                <small>{frozenPayoutKas} KAS · buyer co-signs</small>
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void prepareAction("arbitrate", { buyerShareSompi: 0n, mediatorParty: "seller" })
                }
                type="button"
              >
                <strong>Award seller</strong>
                <small>{frozenPayoutKas} KAS · seller co-signs</small>
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {prepared ? (
        <section className="escrow-link-card escrow-link-review">
          <span className="escrow-link-step">Final check</span>
          <h2>{prepared.review.mode.replaceAll(/([A-Z])/g, " $1")}</h2>
          <p>Your passkey signs only the amounts and recipients shown here.</p>
          <dl>
            {prepared.review.outputs.map((output) => (
              <div key={`${output.recipient}:${output.amountSompi}`}>
                <dt>{output.recipient}</dt>
                <dd>
                  {formatSompiToKaspa(output.amountSompi)} KAS · {output.recipientAddress}
                </dd>
              </div>
            ))}
            <div>
              <dt>Required signatures</dt>
              <dd>{prepared.review.requiredRoles.join(" + ")}</dd>
            </div>
          </dl>
          <button
            className="btn btn-primary escrow-link-primary"
            disabled={
              busy || !selectedRole || !prepared.review.requiredRoles.includes(selectedRole)
            }
            onClick={() => void signAndSubmit()}
            type="button"
          >
            {busy
              ? "Signing…"
              : selectedRole
                ? `Sign as ${selectedRole}`
                : "Select your role first"}
          </button>
          <button
            className="escrow-link-text-button"
            disabled={busy}
            onClick={() => setPrepared(null)}
            type="button"
          >
            Back
          </button>
        </section>
      ) : null}

      {escrow.phase === "complete" && escrow.terminal ? (
        <section className="escrow-link-card escrow-link-receipt">
          <span className="escrow-link-check">✓</span>
          <span className="escrow-link-step">Completed</span>
          <h2>{escrow.terminal.mode.replaceAll(/([A-Z])/g, " $1")}</h2>
          <p>The final transaction was submitted to Kaspa Mainnet.</p>
          <code>{escrow.terminal.transactionId}</code>
          <a
            className="btn btn-primary escrow-link-primary"
            href={`https://explorer.kaspa.org/txs/${escrow.terminal.transactionId}`}
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
      <details className="escrow-link-details">
        <summary>Contract rules & verification</summary>
        <dl>
          <div>
            <dt>Seller payout</dt>
            <dd>{escrow.sellerAddress}</dd>
          </div>
          {escrow.buyerAddress ? (
            <div>
              <dt>Buyer refund</dt>
              <dd>{escrow.buyerAddress}</dd>
            </div>
          ) : null}
          <div>
            <dt>Mediator</dt>
            <dd>
              {escrow.mediatorLabel}
              {escrow.mediatorPublicKey ? ` · ${escrow.mediatorPublicKey}` : " · not connected"}
            </dd>
          </div>
          <div>
            <dt>Frozen fallback</dt>
            <dd>{frozenPayoutKas} KAS to seller after 30 days</dd>
          </div>
          <div>
            <dt>Contract template</dt>
            <dd>{escrow.contractTemplateHash}</dd>
          </div>
        </dl>
        <p>
          The mediator cannot sign alone. A mediated award also needs the winning buyer or seller.
          Kaspa Links cannot redirect or take the funds.
        </p>
      </details>
      <footer>Non-custodial · SilverScript · Three independent passkey roles</footer>
    </main>
  );
}
