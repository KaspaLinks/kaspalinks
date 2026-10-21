"use client";

import React, { type ReactNode } from "react";

import { KasFiatValue } from "./KasFiatValue";

/**
 * The unmistakable "it worked" screen: a check mark, one sentence, the KAS
 * amount and what happens next. Same look as the pay page's thank-you hero.
 */
export function SuccessHero({
  amount,
  children,
  compact = false,
  fiatKas,
  title,
}: {
  /** Shown as "<kas> <label>", with the $ / € value under it. */
  amount?: { kas: string; label: string };
  children?: ReactNode;
  /** Smaller, for a confirmation that sits above the next step. */
  compact?: boolean;
  /** $ / € value only, when the amount is already in the title. */
  fiatKas?: string;
  title: string;
}) {
  const fiat = amount?.kas ?? fiatKas;
  return (
    <div
      aria-live="polite"
      className={`pay-success success-hero${compact ? " success-hero-compact" : ""}`}
      role="status"
    >
      <div className="pay-success-check" aria-hidden="true">
        <svg
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          viewBox="0 0 24 24"
        >
          <polyline points="5 13 10 18 19 7" />
        </svg>
      </div>
      <h2 className="pay-success-title">{title}</h2>
      {amount ? (
        <p className="pay-success-amount">
          <strong>{amount.kas}</strong> <span>{amount.label}</span>
        </p>
      ) : null}
      {fiat ? (
        <KasFiatValue amountKas={fiat} className="amount-usd-estimate pay-amount-usd" />
      ) : null}
      {children ? <div className="success-hero-body">{children}</div> : null}
    </div>
  );
}
