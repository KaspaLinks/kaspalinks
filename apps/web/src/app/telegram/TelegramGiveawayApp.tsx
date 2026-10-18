"use client";
import { useCallback, useEffect, useState } from "react";
import { GiveawayV6Studio } from "../giveaway/new/GiveawayV6Studio";
import { GiveawayEntryClient } from "../toccata-lab/giveaway/[publicId]/GiveawayEntryClient";
import { TelegramClaimApp, type TelegramClaimSettings } from "./TelegramClaimApp";
import { TelegramHome, type TelegramView } from "./TelegramHome";
import { TelegramMineApp } from "./TelegramMineApp";
import { TelegramPayApp } from "./TelegramPayApp";

const VIEWS: readonly TelegramView[] = ["claim", "create", "manage", "mine", "pay"];

function readView(): "home" | TelegramView {
  const mode = new URLSearchParams(window.location.search).get("mode");
  return VIEWS.find((view) => view === mode) ?? "home";
}

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
  const [view, setView] = useState<"home" | TelegramView>("home");

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
    setView(readView());
  }, []);

  // Views switch in place (no reload, so Telegram's init data stays); the URL
  // keeps the mode so a view that reads its own parameters still finds them.
  const open = useCallback((next: "home" | TelegramView) => {
    const url = new URL(window.location.href);
    if (next === "home") url.searchParams.delete("mode");
    else url.searchParams.set("mode", next);
    window.history.replaceState(null, "", url.toString());
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  // Telegram's own back button returns to the start screen.
  useEffect(() => {
    const back = window.Telegram?.WebApp?.BackButton;
    if (!back) return;
    const goHome = () => open("home");
    if (view === "home") {
      back.hide();
      return;
    }
    back.show();
    back.onClick(goHome);
    return () => back.offClick(goHome);
  }, [open, view]);

  if (start === null)
    return (
      <main className="main">
        <p role="status">Loading…</p>
      </main>
    );
  const match = /^g_([a-zA-Z0-9_-]{1,48})$/.exec(start);
  if (match && entryEnabled)
    return (
      <GiveawayEntryClient publicId={match[1]!} turnstile={turnstile} botUsername={botUsername} />
    );

  if (view === "claim") return <TelegramClaimApp settings={claim} />;
  if (view === "pay") return <TelegramPayApp />;
  if (view === "mine") return <TelegramMineApp onOpen={open} />;
  if (view === "create" || view === "manage") {
    if (studioEnabled) return <GiveawayV6Studio key={view} surface="telegram" />;
    return (
      <main className="main">
        <section className="card">
          <h1>Giveaways are unavailable</h1>
          <p>Please try again later.</p>
        </section>
      </main>
    );
  }
  return <TelegramHome onOpen={open} />;
}
