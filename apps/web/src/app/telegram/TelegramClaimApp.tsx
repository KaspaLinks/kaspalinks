"use client";

import { useEffect, useState } from "react";

import { ToccataLabClient, type ToccataLabClientProps } from "../toccata-lab/ToccataLabClient";
import { telegramAuthHeaders } from "./telegram-mini-app";

export type TelegramClaimSettings = Pick<
  ToccataLabClientProps,
  "anonymousEnabled" | "autoReturnEnabled" | "capabilities" | "enabled" | "requiredCapabilities"
>;

/**
 * /claim from the bot opens this: the account-free claim link flow inside the
 * Mini App. The claim code is generated in Telegram's browser and never reaches
 * the bot or Kaspa Links; the link goes to a contact through Telegram's share sheet.
 */
export function TelegramClaimApp({ settings }: { settings: TelegramClaimSettings }) {
  const [preset, setPreset] = useState<null | {
    amountKas?: string;
    returnAddress?: string;
    title?: string;
  }>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const amount = params.get("amount")?.trim() ?? "";
    const title = params.get("title")?.trim().slice(0, 80) ?? "";
    const fromCommand = {
      ...(/^\d+(?:\.\d{1,8})?$/.test(amount) ? { amountKas: amount } : {}),
      ...(title ? { title } : {}),
    };
    // The wallet this chat saved once becomes the return address. Without a
    // workspace (or offline) the field simply starts empty.
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4_000);
    void fetch("/api/telegram/links", { headers: telegramAuthHeaders(), signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: null | { wallet?: null | string }) => body?.wallet ?? undefined)
      .catch(() => undefined)
      .then((returnAddress) => {
        window.clearTimeout(timeout);
        if (cancelled) return;
        setPreset({ ...fromCommand, ...(returnAddress ? { returnAddress } : {}) });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  if (!preset) {
    return (
      <main className="main">
        <p role="status">Loading claim link…</p>
      </main>
    );
  }

  return (
    <main className="main-wide toccata-lab-page telegram-claim-page">
      <header className="telegram-claim-head">
        <span className="label">Kaspa Links</span>
        <h1 className="form-section-heading">Send KAS with a claim link</h1>
        <p className="muted">
          Pay once, send the link to one person. If nobody claims it in time, the KAS returns to
          your wallet automatically.
        </p>
      </header>
      <ToccataLabClient
        {...settings}
        initialAmountKas={preset.amountKas}
        initialMode="create"
        initialReturnAddress={preset.returnAddress}
        initialTitle={preset.title}
        surface="telegram"
      />
    </main>
  );
}
