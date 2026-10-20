"use client";

import React, { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

import {
  fiatToKas,
  formatApproxFiatValue,
  formatPriceTime,
  kasToFiat,
  type AmountUnit,
} from "@/lib/price-display";
import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";
import { useKasUsdPrice } from "@/lib/use-kas-usd-price";

const UNIT_STORAGE_KEY = "kaspalinks.amountUnit";
const UNITS: readonly AmountUnit[] = ["KAS", "USD", "EUR"];
const UNIT_LABELS: Record<AmountUnit, string> = { EUR: "€", KAS: "KAS", USD: "$" };
const UNIT_NAMES: Record<AmountUnit, string> = { EUR: "euros", KAS: "KAS", USD: "US dollars" };

function readStoredUnit(): AmountUnit {
  try {
    const stored = window.localStorage.getItem(UNIT_STORAGE_KEY);
    return stored === "EUR" || stored === "USD" ? stored : "KAS";
  } catch {
    return "KAS";
  }
}

function storeUnit(unit: AmountUnit): void {
  try {
    window.localStorage.setItem(UNIT_STORAGE_KEY, unit);
  } catch {
    // Private windows may block storage; the choice then lasts for this page only.
  }
}

type KasAmountInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "inputMode" | "onChange" | "type" | "value"
> & {
  /** Receives the amount in KAS, also while the person types in $ or €. */
  onChange(amountKas: string): void;
  /** Hide the estimate line when the page shows its own. */
  showEstimate?: boolean;
  value: string;
};

/**
 * Amount field that accepts KAS, $ or €. A fiat amount is converted to KAS at
 * the current price as the person types; the form only ever sees KAS. Without
 * a recent price it is a plain KAS field.
 */
export function KasAmountInput({
  onChange,
  showEstimate = true,
  value,
  ...inputProps
}: KasAmountInputProps) {
  const price = useKasUsdPrice();
  const [unit, setUnit] = useState<AmountUnit>("KAS");
  const [fiatText, setFiatText] = useState("");
  // The KAS value this field last produced from fiat text. Any other value came
  // from outside (a preset, a reset) and the fiat text follows it.
  const producedKas = useRef<null | string>(null);
  const lastQuote = useRef<{ rate: null | string | undefined; unit: AmountUnit } | null>(null);

  // An old price is still shown as an estimate but never converts input.
  const rateFor = (option: AmountUnit) =>
    !price || price.old
      ? null
      : option === "EUR"
        ? price.kasEur
        : option === "USD"
          ? price.kasUsd
          : null;
  const activeUnit = unit === "KAS" || rateFor(unit) ? unit : "KAS";
  const rate = rateFor(activeUnit);

  useEffect(() => {
    setUnit(readStoredUnit());
  }, []);

  useEffect(() => {
    const previous = lastQuote.current;
    lastQuote.current = { rate, unit: activeUnit };
    if (activeUnit === "KAS") return;

    if (value !== producedKas.current) {
      // The KAS value came from outside (a preset, a reset): the fiat text follows.
      producedKas.current = value;
      setFiatText(value.trim() ? (kasToFiat(value, rate) ?? "") : "");
      return;
    }

    // A newer price for the same currency: what the person typed is the amount
    // they mean, so it is converted again.
    if (previous?.unit === activeUnit && previous.rate !== rate) {
      const amountKas = fiatToKas(fiatText, rate);
      if (amountKas && amountKas !== value) {
        producedKas.current = amountKas;
        onChange(amountKas);
      }
    }
  }, [activeUnit, fiatText, onChange, rate, value]);

  function chooseUnit(next: AmountUnit) {
    setUnit(next);
    storeUnit(next);
    if (next === "KAS") return;
    producedKas.current = value;
    setFiatText(value.trim() ? (kasToFiat(value, rateFor(next)) ?? "") : "");
  }

  function typeFiat(raw: string) {
    const text = raw.replace(/[^\d.,]/g, "");
    setFiatText(text);
    // Text that is not a positive amount is passed on as it is, so the form
    // shows its usual amount error instead of silently clearing the amount.
    const amountKas = text.trim()
      ? (fiatToKas(text, rate) ?? normalizeLocalizedKasAmountInput(text.trim()))
      : "";
    producedKas.current = amountKas;
    onChange(amountKas);
  }

  const approx = activeUnit === "KAS" ? formatApproxFiatValue(value, price) : null;
  const estimate =
    activeUnit !== "KAS"
      ? fiatToKas(fiatText, rate) && price
        ? `= ${value} KAS · price from ${formatPriceTime(price.pricedAtMs)}`
        : null
      : approx && price?.old
        ? `${approx} · price from ${formatPriceTime(price.pricedAtMs)}`
        : approx;
  const unavailableTitle = price?.old ? "The last KAS price is too old" : "Price not available";

  return (
    <>
      <span className="kas-amount-field">
        <input
          {...inputProps}
          inputMode="decimal"
          onChange={(event) =>
            activeUnit === "KAS" ? onChange(event.target.value) : typeFiat(event.target.value)
          }
          type="text"
          value={activeUnit === "KAS" ? value : fiatText}
        />
        {/* Always shown so the unit is visible; $ and € wait for a price. */}
        <span aria-label="Enter the amount in" className="kas-amount-units" role="group">
          {UNITS.map((option) => (
            <button
              aria-label={UNIT_NAMES[option]}
              aria-pressed={activeUnit === option}
              disabled={option !== "KAS" && !rateFor(option)}
              key={option}
              onClick={() => chooseUnit(option)}
              title={option !== "KAS" && !rateFor(option) ? unavailableTitle : undefined}
              type="button"
            >
              {UNIT_LABELS[option]}
            </button>
          ))}
        </span>
      </span>
      {showEstimate && estimate ? (
        <span className="amount-usd-estimate amount-input-fiat kas-amount-estimate">
          {estimate}
        </span>
      ) : null}
    </>
  );
}
