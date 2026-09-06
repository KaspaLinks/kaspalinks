"use client";
import { useState } from "react";
import { readJsonResponse } from "@/lib/response-json";

export function TelegramGiveawayActions({
  publicId,
  botUsername,
  participant = false,
}: {
  publicId: string;
  botUsername: string;
  participant?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const bot = botUsername.replace(/^@/, "");
  const configured = /^[a-zA-Z0-9_]{5,32}$/.test(bot);
  const entryPath = `/toccata-lab/giveaway/${encodeURIComponent(publicId)}`;
  async function share() {
    setNotice(null);
    setBusy(true);
    try {
      const app = window.Telegram?.WebApp;
      if (configured && app?.initData && app.shareMessage && app.isVersionAtLeast?.("8.0")) {
        const response = await fetch(
          `/api/telegram/giveaways/${encodeURIComponent(publicId)}/share`,
          {
            method: "POST",
            headers: { "x-telegram-mini-app-init-data": app.initData },
          },
        );
        const body = await readJsonResponse<{ id?: string; error?: { message?: string } }>(
          response,
        );
        if (!response.ok || !body?.id)
          throw new Error(body?.error?.message ?? "Share card unavailable.");
        app.shareMessage(body.id, (sent) =>
          setNotice(
            sent ? "Giveaway shared." : "Sharing cancelled. You can try again or copy the link.",
          ),
        );
      } else {
        // The user selects a destination and confirms sending in Telegram.
        const url = `${window.location.origin}${entryPath}`;
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent("Join this Kaspa giveaway")}`;
        if (app?.openTelegramLink) app.openTelegramLink(shareUrl);
        else window.open(shareUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sharing failed. Try copying the link.");
    } finally {
      setBusy(false);
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${entryPath}`);
      setNotice("Giveaway link copied.");
    } catch {
      setNotice("Open the giveaway in your browser to copy its address.");
    }
  }
  return (
    <section aria-label="Share giveaway and reminders">
      <div className="row">
        <button className="btn" type="button" onClick={() => void share()} disabled={busy}>
          {busy ? "Preparing card…" : "Share on Telegram"}
        </button>
        <button className="btn" type="button" onClick={() => void copyLink()}>
          Copy link
        </button>
        {participant && configured ? (
          <a
            className="btn"
            href={`https://t.me/${bot}?start=watch_${encodeURIComponent(publicId)}`}
            target="_blank"
            rel="noreferrer"
          >
            Notify me of the result
          </a>
        ) : null}
        {participant ? (
          <a
            className="btn btn-primary"
            href={`/toccata-lab/giveaway?template=${encodeURIComponent(publicId)}`}
          >
            Create my own giveaway
          </a>
        ) : null}
      </div>
      {participant && configured ? (
        <p className="muted">
          Result reminders are optional. Confirm in the bot; use /stop to turn them off.
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
