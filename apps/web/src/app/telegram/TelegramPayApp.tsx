"use client";

import { useEffect, useState } from "react";

import { KASPA_ADDRESS_INPUT_PROPS } from "@/lib/kaspa-address-input";
import type { TelegramPaymentLinkType } from "@/lib/telegram-links";

import { KasAmountInput } from "../KasAmountInput";

import { readApiError, shareInTelegram, telegramAuthHeaders } from "./telegram-mini-app";

const TYPES: {
  amount: "optional" | "required" | "target";
  label: string;
  placeholder: string;
  value: TelegramPaymentLinkType;
}[] = [
  { amount: "optional", label: "Tip", placeholder: "Buy me a coffee", value: "kaspa.tip" },
  {
    amount: "optional",
    label: "Donation",
    placeholder: "Support the project",
    value: "kaspa.donation",
  },
  { amount: "target", label: "Goal", placeholder: "New microphone", value: "kaspa.goal" },
  { amount: "required", label: "Invoice", placeholder: "Logo design", value: "kaspa.invoice" },
  {
    amount: "required",
    label: "Fixed amount",
    placeholder: "Concert ticket",
    value: "kaspa.transfer",
  },
];

type Created = { title: string; url: string };

/** "Get paid": a payment link without command syntax, owned by this Telegram chat. */
export function TelegramPayApp() {
  const [type, setType] = useState<TelegramPaymentLinkType>("kaspa.tip");
  const [title, setTitle] = useState("");
  const [amountKas, setAmountKas] = useState("");
  const [wallet, setWallet] = useState("");
  const [alerts, setAlerts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const selected = TYPES.find((option) => option.value === type) ?? TYPES[0]!;

  useEffect(() => {
    void fetch("/api/telegram/links", { headers: telegramAuthHeaders() })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: null | { alertsEnabled?: boolean; wallet?: null | string }) => {
        if (body?.wallet) setWallet(body.wallet);
        // Someone who already answered keeps their choice; new chats start with alerts on.
        if (body?.wallet && body.alertsEnabled === false) setAlerts(false);
      })
      .catch(() => undefined);
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/telegram/payment-links", {
        body: JSON.stringify({
          alerts,
          ...(amountKas.trim() ? { amountKas: amountKas.trim() } : {}),
          title: title.trim(),
          type,
          walletAddress: wallet.trim(),
        }),
        headers: { ...telegramAuthHeaders(), "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setError(await readApiError(response, "The link could not be created."));
        return;
      }
      const body = (await response.json()) as { action: Created };
      setCreated(body.action);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copying failed. Long-press the link instead.");
    }
  }

  if (created) {
    return (
      <main className="main telegram-claim-page">
        <section className="card batch-drop-panel">
          <div className="batch-drop-card batch-drop-done">
            <strong>{created.title} is ready</strong>
            <p className="value-mono">{created.url}</p>
            <div className="claimable-action-row">
              <button
                className="btn btn-primary"
                onClick={() => shareInTelegram(created.url, created.title)}
                type="button"
              >
                Send in Telegram
              </button>
              <button className="btn" onClick={() => void copy(created.url)} type="button">
                {copied ? "Copied!" : "Copy link"}
              </button>
            </div>
            <p>
              Payments go straight to your wallet.
              {alerts ? " The bot tells you here when one arrives." : ""}
            </p>
          </div>
          <button
            className="btn"
            onClick={() => {
              setCreated(null);
              setTitle("");
              setAmountKas("");
            }}
            type="button"
          >
            Create another link
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="main telegram-claim-page">
      <header className="telegram-claim-head">
        <span className="label">Kaspa Links</span>
        <h1 className="form-section-heading">Get paid in KAS</h1>
        <p className="muted">One link to share. Payments go straight to your wallet.</p>
      </header>
      <section className="card batch-drop-single">
        <form className="claimable-lab-form batch-drop-form" onSubmit={create}>
          <div className="type-segmented telegram-type-picker" role="group" aria-label="Link type">
            {TYPES.map((option) => (
              <button
                aria-pressed={type === option.value}
                className={`type-segment${type === option.value ? " type-segment-active" : ""}`}
                key={option.value}
                onClick={() => setType(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="telegram-pay-title">
              Title
            </label>
            <input
              id="telegram-pay-title"
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={selected.placeholder}
              required
              value={title}
            />
          </div>
          <div>
            <label className="label" htmlFor="telegram-pay-amount">
              {selected.amount === "target"
                ? "Goal"
                : selected.amount === "optional"
                  ? "Amount, optional"
                  : "Amount"}
            </label>
            <KasAmountInput
              id="telegram-pay-amount"
              onChange={setAmountKas}
              placeholder={selected.amount === "optional" ? "Any amount" : "10"}
              required={selected.amount !== "optional"}
              value={amountKas}
            />
          </div>
          <div>
            <label className="label" htmlFor="telegram-pay-wallet">
              Your wallet
            </label>
            <input
              id="telegram-pay-wallet"
              {...KASPA_ADDRESS_INPUT_PROPS}
              onChange={(event) => setWallet(event.target.value)}
              placeholder="kaspa:…"
              required
              value={wallet}
            />
            <p className="muted">Saved for your next links. Use your own wallet.</p>
          </div>
          <label className="telegram-pay-alerts">
            <input
              checked={alerts}
              onChange={(event) => setAlerts(event.target.checked)}
              type="checkbox"
            />
            <span>Tell me in this chat when a payment arrives</span>
          </label>
          {error ? <p className="error-text">{error}</p> : null}
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy ? "Creating…" : "Create link"}
          </button>
        </form>
      </section>
    </main>
  );
}
