"use client";
import { useEffect, useState } from "react";
import { GiveawayV6Studio } from "../giveaway/new/GiveawayV6Studio";
import { GiveawayEntryClient } from "../toccata-lab/giveaway/[publicId]/GiveawayEntryClient";
import { TelegramClaimApp, type TelegramClaimSettings } from "./TelegramClaimApp";

export function TelegramGiveawayApp({
  claim,
  entryEnabled,
  studioEnabled,
  turnstile,
  botUsername,
}: {
  claim: TelegramClaimSettings;
  entryEnabled: boolean;
  studioEnabled: boolean;
  turnstile: { required: boolean; siteKey: string };
  botUsername: string;
}) {
  const [start, setStart] = useState<string | null>(null);
  useEffect(() => {
    const app = window.Telegram?.WebApp;
    app?.ready();
    app?.expand();
    // Navigation only: this parameter never authorizes a Creator operation.
    setStart(
      app?.initDataUnsafe?.start_param ??
        new URLSearchParams(window.location.search).get("tgWebAppStartParam") ??
        "",
    );
  }, []);
  if (start === null)
    return (
      <main className="main">
        <p role="status">Loading giveaway…</p>
      </main>
    );
  if (new URLSearchParams(window.location.search).get("mode") === "claim") {
    return <TelegramClaimApp settings={claim} />;
  }
  const match = /^g_([a-zA-Z0-9_-]{1,48})$/.exec(start);
  if (match && entryEnabled)
    return (
      <GiveawayEntryClient publicId={match[1]!} turnstile={turnstile} botUsername={botUsername} />
    );
  if (studioEnabled) return <GiveawayV6Studio surface="telegram" />;
  return (
    <main className="main">
      <section className="card">
        <h1>Giveaways are unavailable</h1>
        <p>Please try again later.</p>
      </section>
    </main>
  );
}
