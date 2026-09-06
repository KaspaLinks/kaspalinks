"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { GiveawayEntryClient } from "../toccata-lab/giveaway/[publicId]/GiveawayEntryClient";

export function TelegramGiveawayApp({
  enabled,
  turnstile,
  botUsername,
}: {
  enabled: boolean;
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
  if (!enabled)
    return (
      <main className="main">
        <h1>Giveaways are unavailable</h1>
      </main>
    );
  const match = /^g_([a-zA-Z0-9_-]{1,48})$/.exec(start);
  if (match)
    return (
      <GiveawayEntryClient publicId={match[1]!} turnstile={turnstile} botUsername={botUsername} />
    );
  return (
    <main className="main">
      <section className="card">
        <h1>Kaspa giveaways</h1>
        <p>Open a shared giveaway to enter and check its result.</p>
        <Link className="btn btn-primary" href="/toccata-lab/giveaway">
          Create a giveaway
        </Link>
      </section>
    </main>
  );
}
