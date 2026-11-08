import type { Metadata } from "next";
import { notFound } from "next/navigation";
import React from "react";

import { telegramBotUsername } from "@/lib/telegram-bot";

import { CopyBotUsername } from "./CopyBotUsername";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Send KAS with a link, get paid or run a fair on-chain giveaway from a Telegram chat. No account, no email.";

export const metadata: Metadata = {
  alternates: { canonical: "/bot" },
  description: DESCRIPTION,
  openGraph: {
    description: DESCRIPTION,
    title: "Kaspa Links in Telegram",
    type: "website",
    url: "/bot",
  },
  title: "Kaspa Links in Telegram",
  twitter: {
    card: "summary_large_image",
    description: DESCRIPTION,
    title: "Kaspa Links in Telegram",
  },
};

// The same four jobs as the Mini App start screen.
const FEATURES = [
  { body: "A claim link for one person. Unclaimed KAS comes back to you.", title: "Send KAS" },
  { body: "Tips, donations, goals or invoices, paid straight to your wallet.", title: "Get paid" },
  { body: "Fund a prize once; a fair on-chain draw picks the winner.", title: "Giveaway" },
  { body: "Your links, claims and payments in one list.", title: "My links" },
] as const;

/**
 * Landing page for posts that promote the bot. X's in-app browser on iPhone
 * cannot follow t.me's "Start" button into Telegram, so this page links to the
 * bot and also tells people how to reach it by hand.
 */
export default function BotPage() {
  const username = telegramBotUsername();
  if (!username) notFound();
  return (
    <main className="main bot-page">
      <section className="bot-hero">
        <span className="hero-eyebrow">Kaspa Links in Telegram</span>
        <h1>Kaspa payments, right in your chats.</h1>
        <p className="hero-sub">
          Send KAS with a link, get paid or run a fair giveaway without leaving Telegram. No
          account, no email. Your KAS never passes through Kaspa Links.
        </p>
        <a className="btn btn-primary bot-open" href={`https://t.me/${username}`}>
          Open @{username} in Telegram
        </a>
      </section>

      <section className="card bot-fallback">
        <h2>Nothing happens when you tap Start?</h2>
        <p>
          Some in-app browsers, like the one in X on iPhone, cannot open Telegram. Open Telegram
          yourself and search for the bot:
        </p>
        <CopyBotUsername username={username} />
        <p className="muted">Or open this page in Safari or Chrome and tap the button again.</p>
      </section>

      <section aria-label="What the bot does" className="bot-features">
        {FEATURES.map((feature) => (
          <div className="bot-feature" key={feature.title}>
            <strong>{feature.title}</strong>
            <span>{feature.body}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
