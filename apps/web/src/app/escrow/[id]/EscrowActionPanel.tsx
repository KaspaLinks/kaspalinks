"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ClockIcon, KeyIcon, LockIcon } from "../_components/EscrowIcons";
import { EscrowKasAmount } from "../_components/EscrowKasAmount";
import {
  formatKasAmount,
  outcomePayout,
  refundPayout,
  releasePayout,
  type EscrowAmounts,
} from "../_lib/escrow-amounts";
import {
  freezeReasonLabel,
  getTimeRemaining,
  type EscrowActionId,
  type EscrowTransition,
} from "../_lib/escrow-status";
import type { EscrowDeal, EscrowRole } from "../_lib/escrow-types";
import { EscrowFreezeForm } from "./EscrowFreezeForm";
import { EscrowSettlementForm } from "./EscrowSettlementForm";
import { EscrowShipmentForm } from "./EscrowShipmentForm";

export type SettlementProposal = {
  buyerSompi: bigint;
  sellerSompi: bigint;
  signedBy: EscrowRole;
};

type PanelProps = {
  actions: EscrowActionId[];
  amounts: EscrowAmounts;
  deadlinePassed: boolean;
  deal: EscrowDeal;
  flash: null | string;
  nowMs: number;
  onProposalChange: (proposal: null | SettlementProposal) => void;
  onTransition: (transition: EscrowTransition, message: string) => void;
  proposal: null | SettlementProposal;
  role: EscrowRole;
};

// Stand-in for the address a connected wallet would provide.
const PROTOTYPE_BUYER_ADDRESS = "kaspa:qyou…demo";

const NO_KAS_SENT = "Prototype: no KAS were sent and no transaction was created.";

function PanelShell({
  children,
  eyebrow,
  flash,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  flash: null | string;
  title: string;
}) {
  return (
    <section aria-labelledby="escrow-panel-heading" className="card pay-card escrow-panel">
      {flash ? (
        <p className="notice escrow-flash" role="status">
          {flash}
        </p>
      ) : null}
      <div>
        <span className="label">{eyebrow}</span>
        <h2 id="escrow-panel-heading">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ConfirmAction({
  className,
  confirmLabel,
  label,
  onConfirm,
  question,
}: {
  className: string;
  confirmLabel: string;
  label: string;
  onConfirm: () => void;
  question: string;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button className={className} onClick={() => setAsking(true)} type="button">
        {label}
      </button>
    );
  }

  return (
    <div aria-label={label} className="escrow-confirm" role="group">
      <p>{question}</p>
      <div className="row">
        <button autoFocus className="btn btn-primary" onClick={onConfirm} type="button">
          {confirmLabel}
        </button>
        <button className="btn" onClick={() => setAsking(false)} type="button">
          Go back
        </button>
      </div>
    </div>
  );
}

function Countdown({ deadline, nowMs, text }: { deadline: string; nowMs: number; text: string }) {
  const remaining = getTimeRemaining(deadline, nowMs);
  return (
    <div className="escrow-countdown">
      <ClockIcon />
      <div>
        <p className="escrow-countdown-time">
          {remaining.passed ? remaining.label : `${remaining.label} remaining`}
        </p>
        <p className="escrow-countdown-text">{text}</p>
      </div>
    </div>
  );
}

function ShipmentLine({ deal }: { deal: EscrowDeal }) {
  if (!deal.shipment) return null;
  return (
    <p className="escrow-shipment-line">
      Shipped with {deal.shipment.carrier}
      {deal.shipment.trackingNumber ? (
        <>
          {" "}
          · Tracking <span className="value-mono">{deal.shipment.trackingNumber}</span>
        </>
      ) : null}
    </p>
  );
}

export function EscrowActionPanel(props: PanelProps) {
  const { actions, amounts, deadlinePassed, deal, flash, nowMs, onTransition, role } = props;
  const [freezing, setFreezing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const can = (action: EscrowActionId) => actions.includes(action);

  const release = releasePayout(amounts);
  const refund = refundPayout(amounts);
  const releaseQuestion = `Release ${formatKasAmount(amounts.itemTotalSompi)} KAS to the seller? This cannot be undone.`;
  const refundQuestion = `Refund the buyer? They get ${formatKasAmount(refund.buyerSompi)} KAS back before any remaining network fee.`;

  const refundButton = can("refund_buyer") ? (
    <ConfirmAction
      className="btn btn-danger btn-block"
      confirmLabel="Refund buyer"
      label="Refund buyer"
      onConfirm={() => onTransition({ type: "refund_buyer" }, `${NO_KAS_SENT} Buyer refunded.`)}
      question={refundQuestion}
    />
  ) : null;

  const releaseButton = can("release") ? (
    <ConfirmAction
      className="btn btn-primary btn-block btn-pay"
      confirmLabel="Release payment"
      label={deal.shipment ? "Everything is OK: release payment" : "Release payment"}
      onConfirm={() => onTransition({ type: "release" }, `${NO_KAS_SENT} Payment released.`)}
      question={releaseQuestion}
    />
  ) : null;

  const freezeButton = can("freeze") ? (
    <button className="btn btn-block" onClick={() => setFreezing(true)} type="button">
      Report a problem
    </button>
  ) : null;

  const claimButton = can("claim_after_deadline") ? (
    <button
      className="btn btn-primary btn-block btn-pay"
      onClick={() =>
        onTransition({ type: "claim_after_deadline" }, `${NO_KAS_SENT} Payment claimed.`)
      }
      type="button"
    >
      Claim {formatKasAmount(release.sellerSompi)} KAS
    </button>
  ) : null;

  if (freezing && can("freeze")) {
    return (
      <PanelShell eyebrow="Report a problem" flash={null} title="Freeze the escrow">
        <EscrowFreezeForm
          onCancel={() => setFreezing(false)}
          onSubmit={(reason, note) =>
            onTransition(
              { note, reason, type: "freeze" },
              `${NO_KAS_SENT} Escrow frozen. Settle on a split with the seller.`,
            )
          }
        />
      </PanelShell>
    );
  }

  switch (deal.status) {
    case "draft":
    case "awaiting_buyer":
      return (
        <PanelShell eyebrow="Not open yet" flash={flash} title="Waiting for the buyer">
          <p>The seller is preparing the final terms or waiting for the invited buyer to join.</p>
        </PanelShell>
      );

    case "awaiting_funding":
      if (role === "seller") {
        const url = `${window.location.origin}/escrow/${deal.id}`;
        return (
          <PanelShell eyebrow="Your next step" flash={flash} title="Share your escrow link">
            <p>Send this link to the buyer wherever you agreed the deal.</p>
            <p className="escrow-share-url value-mono">{url}</p>
            <div className="row-stack">
              <button
                className="btn btn-primary btn-block"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
                type="button"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <ConfirmAction
                className="btn btn-block"
                confirmLabel="Cancel link"
                label="Cancel link"
                onConfirm={() =>
                  onTransition({ type: "cancel_link" }, `${NO_KAS_SENT} Link cancelled.`)
                }
                question="Cancel this link? Nobody has paid yet."
              />
            </div>
          </PanelShell>
        );
      }
      return (
        <PanelShell eyebrow="Checkout" flash={flash} title="Pay into escrow">
          <EscrowKasAmount label="You lock" sompi={amounts.buyerLockSompi} />
          <p className="escrow-pay-split">
            {formatKasAmount(amounts.itemTotalSompi)} KAS for the item and shipping, plus network
            fees.
          </p>
          <ul className="escrow-trust-list">
            <li>
              <LockIcon />
              <span>Locked by a Kaspa covenant, not held by anyone</span>
            </li>
            <li>
              <ClockIcon />
              <span>You can release or freeze the active payment</span>
            </li>
            <li>
              <KeyIcon />
              <span>KaspaLinks never holds your KAS or keys</span>
            </li>
          </ul>
          <label className="form-toggle escrow-ack">
            <input
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              type="checkbox"
            />
            <span className="form-toggle-body">
              <span className="form-toggle-help">
                I agreed this deal with @{deal.sellerUsername} and understand that a frozen escrow
                needs both signatures for a split, or the seller can refund me alone.
              </span>
            </span>
          </label>
          <button
            className="btn btn-primary btn-block btn-pay"
            disabled={!acknowledged}
            onClick={() =>
              onTransition(
                { buyerAddressLabel: PROTOTYPE_BUYER_ADDRESS, type: "pay" },
                `${NO_KAS_SENT} In the live version your wallet signs this payment.`,
              )
            }
            type="button"
          >
            Pay with Kaspa
          </button>
        </PanelShell>
      );

    case "active": {
      const deadline = deal.releaseDeadline;

      if (role === "seller") {
        const shipping = deal.shipment === null;
        return (
          <PanelShell
            eyebrow="Your next step"
            flash={flash}
            title={
              deadlinePassed
                ? "Deadline passed"
                : shipping
                  ? "Prepare shipment"
                  : "Waiting for the buyer"
            }
          >
            {claimButton ? (
              <>
                <p>
                  You can claim now. The buyer can still freeze; the first confirmed spend wins.
                </p>
                {claimButton}
              </>
            ) : null}
            {shipping ? (
              <>
                <p>
                  The buyer’s payment is locked. Ship the item and add tracking so the buyer can
                  follow it.
                </p>
                <EscrowShipmentForm
                  onSubmit={(carrier, trackingNumber) =>
                    onTransition(
                      { carrier, trackingNumber, type: "mark_shipped" },
                      "Prototype: marked as shipped. Tracking stays in this browser.",
                    )
                  }
                />
              </>
            ) : (
              <ShipmentLine deal={deal} />
            )}
            {deadline && !deadlinePassed ? (
              <Countdown
                deadline={deadline}
                nowMs={nowMs}
                text="If the buyer neither releases nor freezes the escrow by then, you can claim the payment."
              />
            ) : null}
            {refundButton}
          </PanelShell>
        );
      }

      return (
        <PanelShell
          eyebrow="Your next step"
          flash={flash}
          title={
            deadlinePassed
              ? "Deadline passed"
              : deal.shipment !== null
                ? "Check your item"
                : "Waiting for shipment"
          }
        >
          {deal.shipment !== null ? <ShipmentLine deal={deal} /> : null}
          <p>
            {deadlinePassed
              ? "The seller can now claim. You can still release or freeze, but a claim may confirm first."
              : deal.shipment !== null
                ? "When it arrives, check that everything matches the description. If it does, release the payment. If not, freeze promptly. After the deadline, the seller can race your freeze with a claim."
                : "Your payment is locked while the seller prepares the shipment. If nothing arrives, freeze promptly. The seller can claim after the deadline."}
          </p>
          {deadline && !deadlinePassed ? (
            <Countdown
              deadline={deadline}
              nowMs={nowMs}
              text="After the deadline the seller can claim the payment, unless you report a problem first."
            />
          ) : null}
          <div className="row-stack">
            {releaseButton}
            {freezeButton}
          </div>
        </PanelShell>
      );
    }

    case "frozen":
      return (
        <PanelShell eyebrow="Frozen" flash={flash} title="Settle on a split">
          {deal.freeze ? (
            <div className="escrow-freeze-summary">
              <p>
                <strong>Buyer reported:</strong> {freezeReasonLabel(deal.freeze.reason)}
              </p>
              {deal.freeze.note ? <blockquote>{deal.freeze.note}</blockquote> : null}
            </div>
          ) : null}
          <p>
            Agree on a split and both sign it. The seller can instead refund the buyer alone.
            Network fees reduce the final refund or settlement.
          </p>
          {refundButton}
          <EscrowSettlementForm
            amounts={amounts}
            onProposalChange={props.onProposalChange}
            onSettle={(proposal) =>
              onTransition(
                {
                  buyerSompi: proposal.buyerSompi,
                  sellerSompi: proposal.sellerSompi,
                  type: "settle",
                },
                `${NO_KAS_SENT} Both signed, the escrow is settled.`,
              )
            }
            proposal={props.proposal}
            role={role}
          />
        </PanelShell>
      );

    case "unknown_spend":
      return (
        <PanelShell eyebrow="Review needed" flash={flash} title="Unknown covenant spend">
          <p>
            The funding output was spent in a way this prototype has not classified. Do not create
            another transaction until the on-chain transaction has been reviewed.
          </p>
        </PanelShell>
      );

    case "cancelled_unfunded":
    case "claimed":
    case "refunded":
    case "released":
    case "settled": {
      const payout = outcomePayout(deal);
      const title = {
        cancelled_unfunded: "Link cancelled",
        claimed: "Claimed after the deadline",
        refunded: "Buyer refunded",
        released: "Deal completed",
        settled: "Settled by agreement",
      }[deal.status];

      return (
        <PanelShell eyebrow="Closed" flash={flash} title={title}>
          {payout ? (
            <dl className="escrow-amounts">
              <div
                className={`escrow-amounts-row${role === "buyer" ? " escrow-amounts-row-strong" : ""}`}
              >
                <dt>{role === "buyer" ? "You received" : "Buyer received"}</dt>
                <dd>{formatKasAmount(payout.buyerSompi)} KAS</dd>
              </div>
              <div
                className={`escrow-amounts-row${role === "seller" ? " escrow-amounts-row-strong" : ""}`}
              >
                <dt>{role === "seller" ? "You received" : "Seller received"}</dt>
                <dd>{formatKasAmount(payout.sellerSompi)} KAS</dd>
              </div>
            </dl>
          ) : null}
          <p className="muted">Nothing is locked anymore. This escrow link is closed.</p>
          {role === "seller" ? (
            <Link className="btn btn-block" href="/escrow/new">
              Create another escrow link
            </Link>
          ) : null}
        </PanelShell>
      );
    }
  }
}
