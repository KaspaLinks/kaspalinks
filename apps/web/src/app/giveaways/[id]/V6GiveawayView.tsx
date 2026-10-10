import type { GiveawayV6ReconstructionSnapshot } from "@kaspa-actions/kaspa-indexer";
import React from "react";

type Props = {
  amountKas: string;
  closesAt: Date;
  closesAtDaa: string;
  lastSyncedAt: Date | null;
  network: "mainnet" | "testnet-10";
  publicId: string;
  returnAtDaa: string;
  snapshot: GiveawayV6ReconstructionSnapshot;
  title: string;
  transitionCount: number;
  username: string;
  verificationPaused: boolean;
  winnerAddress: string | null;
};

const phaseOrder = ["awaiting_activation", "open", "frozen", "drawn", "returned"] as const;

export default function V6GiveawayView(props: Props) {
  const phaseIndex = phaseOrder.indexOf(props.snapshot.phase);
  const terminal = props.snapshot.phase === "drawn" || props.snapshot.phase === "returned";
  const participantCount =
    props.snapshot.frozenEntryCount ?? props.snapshot.observedRegistrationCount;
  const explorerBase = props.network === "mainnet" ? "https://explorer.kaspa.org" : null;

  return (
    <main className="main giveaway-entry-page giveaway-v6-page">
      <section className="giveaway-entry-hero">
        <span className="hero-eyebrow">On-chain Kaspa giveaway · @{props.username}</span>
        <h1>{props.title}</h1>
        <div className="giveaway-hero-prize">
          <span className="label">Prize</span>
          <strong>{props.amountKas} KAS</strong>
        </div>
      </section>

      <section className="card giveaway-entry-card">
        <div className="giveaway-v6-status-row" role="status">
          <span className={`status-chip status-${statusTone(props.snapshot.phase)}`}>
            {phaseLabel(props.snapshot.phase)}
          </span>
          <span>{props.verificationPaused ? "Verification paused" : "Verified from Kaspa L1"}</span>
        </div>

        <div className="giveaway-v6-steps" aria-label="Giveaway progress">
          <ProgressStep
            number="1"
            title="Prize secured"
            detail={phaseIndex >= 1 ? "SilverScript activated" : "Waiting for confirmation"}
            state={phaseIndex >= 1 ? "complete" : "active"}
          />
          <ProgressStep
            number="2"
            title="Entries"
            detail={`${participantCount} confirmed on-chain`}
            state={phaseIndex > 1 ? "complete" : phaseIndex === 1 ? "active" : "pending"}
          />
          <ProgressStep
            number="3"
            title="Result"
            detail={
              terminal
                ? props.snapshot.phase === "drawn"
                  ? "Winner paid"
                  : "Prize returned"
                : "Automatic after close"
            }
            state={terminal ? "complete" : phaseIndex === 2 ? "active" : "pending"}
          />
        </div>

        <div className="covenant-participant-count giveaway-v6-count">
          <strong>{participantCount}</strong>
          <span>{participantCount === 1 ? "confirmed participant" : "confirmed participants"}</span>
          <span className="label">1 winner</span>
        </div>

        <PhasePanel
          closesAt={props.closesAt}
          explorerBase={explorerBase}
          snapshot={props.snapshot}
          winnerAddress={props.winnerAddress}
        />

        <div className="giveaway-entry-meta">
          <span>SilverScript V6 · {props.network === "mainnet" ? "Mainnet" : "Testnet 10"}</span>
          <span>Free entry · no account required</span>
        </div>

        <details className="giveaway-proof">
          <summary>Verify the giveaway on-chain</summary>
          <div className="giveaway-v6-proof-grid">
            <ProofFact label="Accepted transitions" value={String(props.transitionCount)} />
            <ProofFact label="Entry close DAA" value={props.closesAtDaa} mono />
            <ProofFact label="Fallback return DAA" value={props.returnAtDaa} mono />
            <ProofFact
              label="Last verified"
              value={props.lastSyncedAt ? formatDate(props.lastSyncedAt) : "Waiting for first scan"}
            />
            <ProofFact
              label="Frozen entries root"
              value={props.snapshot.frozenRootHex ?? "Created when entries close"}
              mono
            />
            <ProofFact
              label="Terminal transaction"
              value={props.snapshot.terminalTransactionId ?? "Created after the draw or return"}
              mono
            />
          </div>
          <p>
            Entries, eligibility and the winner are reconstructed from accepted covenant
            transactions. Kaspa Links cannot add a database-only participant or replace the on-chain
            result.
          </p>
          <a
            className="btn btn-small"
            href={`/api/giveaways/${encodeURIComponent(props.publicId)}/verification`}
            target="_blank"
            rel="noreferrer"
          >
            Open verification data
          </a>
        </details>
      </section>
      <p className="giveaway-entry-footnote">Non-custodial · enforced by SilverScript</p>
    </main>
  );
}

function ProgressStep({
  detail,
  number,
  state,
  title,
}: {
  detail: string;
  number: string;
  state: "active" | "complete" | "pending";
  title: string;
}) {
  return (
    <div className={`giveaway-v6-step is-${state}`}>
      <span>{state === "complete" ? "✓" : number}</span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function PhasePanel({
  closesAt,
  explorerBase,
  snapshot,
  winnerAddress,
}: {
  closesAt: Date;
  explorerBase: string | null;
  snapshot: GiveawayV6ReconstructionSnapshot;
  winnerAddress: string | null;
}) {
  if (snapshot.phase === "awaiting_activation") {
    return (
      <div className="giveaway-result-state">
        <h2>Waiting for prize activation</h2>
        <p>The giveaway opens after the funded SilverScript family is confirmed on Kaspa.</p>
      </div>
    );
  }
  if (snapshot.phase === "open") {
    return (
      <div className="giveaway-result-state giveaway-v6-open-panel">
        <h2>Entries are open</h2>
        <p>Closing time: {formatDate(closesAt)}. An entry counts only after Kaspa confirms it.</p>
      </div>
    );
  }
  if (snapshot.phase === "frozen") {
    return (
      <div className="giveaway-result-state">
        <h2>Entries locked · drawing winner</h2>
        <p>The participant root is frozen. The committed Kaspa block now determines the result.</p>
      </div>
    );
  }
  if (snapshot.phase === "returned") {
    return (
      <div className="giveaway-result-state">
        <h2>Giveaway ended · prize returned</h2>
        <p>SilverScript returned the remaining funds to the address committed before funding.</p>
        {snapshot.terminalTransactionId && explorerBase ? (
          <a
            className="btn btn-primary"
            href={`${explorerBase}/txs/${snapshot.terminalTransactionId}`}
            target="_blank"
            rel="noreferrer"
          >
            View return transaction
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <div className="giveaway-result-state is-winner">
      <span className="label">Winner</span>
      <h2>Prize paid automatically</h2>
      <p className="covenant-winner-address">
        {winnerAddress ?? snapshot.winner?.payoutScriptPublicKeyHex ?? "Winner output confirmed"}
      </p>
      {snapshot.terminalTransactionId && explorerBase ? (
        <a
          className="btn btn-primary"
          href={`${explorerBase}/txs/${snapshot.terminalTransactionId}`}
          target="_blank"
          rel="noreferrer"
        >
          View payout transaction
        </a>
      ) : null}
    </div>
  );
}

function ProofFact({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div>
      <span>{label}</span>
      {mono ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}

function phaseLabel(phase: GiveawayV6ReconstructionSnapshot["phase"]): string {
  if (phase === "awaiting_activation") return "Confirming prize";
  if (phase === "open") return "Entries open";
  if (phase === "frozen") return "Drawing";
  if (phase === "drawn") return "Completed";
  return "Returned";
}

function statusTone(phase: GiveawayV6ReconstructionSnapshot["phase"]): string {
  if (phase === "awaiting_activation") return "pending_funding";
  if (phase === "open" || phase === "drawn") return "open";
  return "closed";
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}
