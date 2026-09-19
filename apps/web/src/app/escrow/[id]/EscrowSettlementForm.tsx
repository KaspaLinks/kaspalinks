"use client";

import { useState, type FormEvent } from "react";

import {
  evenSplitPayout,
  formatKasAmount,
  refundPayout,
  releasePayout,
  splitSettlement,
  toPlainKas,
  type EscrowAmounts,
  type EscrowPayout,
} from "../_lib/escrow-amounts";
import type { EscrowRole } from "../_lib/escrow-types";
import type { SettlementProposal } from "./EscrowActionPanel";

function otherParty(role: EscrowRole): EscrowRole {
  return role === "buyer" ? "seller" : "buyer";
}

function SplitSummary({ split }: { split: EscrowPayout }) {
  return (
    <dl className="escrow-amounts">
      <div className="escrow-amounts-row">
        <dt>Buyer receives</dt>
        <dd>{formatKasAmount(split.buyerSompi)} KAS</dd>
      </div>
      <div className="escrow-amounts-row">
        <dt>Seller receives</dt>
        <dd>{formatKasAmount(split.sellerSompi)} KAS</dd>
      </div>
    </dl>
  );
}

export function EscrowSettlementForm({
  amounts,
  onProposalChange,
  onSettle,
  proposal,
  role,
}: {
  amounts: EscrowAmounts;
  onProposalChange: (proposal: null | SettlementProposal) => void;
  onSettle: (split: EscrowPayout) => void;
  proposal: null | SettlementProposal;
  role: EscrowRole;
}) {
  const [buyerKas, setBuyerKas] = useState(() => toPlainKas(evenSplitPayout(amounts).buyerSompi));
  const split = splitSettlement(buyerKas, amounts.totalLockedSompi);
  const other = otherParty(role);

  if (proposal) {
    if (proposal.signedBy === role) {
      return (
        <div className="escrow-settlement">
          <p>You signed this split. It pays out once the {other} signs the same one.</p>
          <SplitSummary split={proposal} />
          <div className="row-stack">
            <button
              className="btn btn-primary btn-block"
              onClick={() => onSettle(proposal)}
              type="button"
            >
              Simulate: {other} signs too
            </button>
            <button className="btn btn-block" onClick={() => onProposalChange(null)} type="button">
              Withdraw proposal
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="escrow-settlement">
        <p>The {proposal.signedBy} proposed and signed this split.</p>
        <SplitSummary split={proposal} />
        <div className="row-stack">
          <button
            className="btn btn-primary btn-block btn-pay"
            onClick={() => onSettle(proposal)}
            type="button"
          >
            Sign the same split
          </button>
          <button className="btn btn-block" onClick={() => onProposalChange(null)} type="button">
            Propose something else
          </button>
        </div>
      </div>
    );
  }

  const presets: ReadonlyArray<{ label: string; payout: EscrowPayout }> = [
    { label: "Full refund", payout: refundPayout(amounts) },
    { label: "Even split", payout: evenSplitPayout(amounts) },
    { label: "Full release", payout: releasePayout(amounts) },
  ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!split.ok) return;
    onProposalChange({
      buyerSompi: split.buyerSompi,
      sellerSompi: split.sellerSompi,
      signedBy: role,
    });
  }

  return (
    <form className="escrow-settlement" noValidate onSubmit={submit}>
      <p className="escrow-settlement-total">
        {formatKasAmount(amounts.totalLockedSompi)} KAS locked in total
      </p>
      <div aria-label="Split presets" className="type-segmented" role="group">
        {presets.map((preset) => {
          const active = split.ok && split.buyerSompi === preset.payout.buyerSompi;
          return (
            <button
              aria-pressed={active}
              className={`type-segment${active ? " type-segment-active" : ""}`}
              key={preset.label}
              onClick={() => setBuyerKas(toPlainKas(preset.payout.buyerSompi))}
              type="button"
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="form-field">
        <label className="label" htmlFor="escrow-split-buyer">
          Buyer receives (KAS)
        </label>
        <input
          aria-describedby="escrow-split-result"
          aria-invalid={split.ok ? undefined : true}
          id="escrow-split-buyer"
          inputMode="decimal"
          onChange={(event) => setBuyerKas(event.target.value)}
          type="text"
          value={buyerKas}
        />
        <p
          aria-live="polite"
          className={`form-field-help${split.ok ? "" : " form-field-warn"}`}
          id="escrow-split-result"
        >
          {split.ok
            ? `Seller share before network fees: ${formatKasAmount(split.sellerSompi)} KAS.`
            : split.message}
        </p>
      </div>
      <button className="btn btn-primary btn-block btn-pay" disabled={!split.ok} type="submit">
        Sign this split
      </button>
    </form>
  );
}
