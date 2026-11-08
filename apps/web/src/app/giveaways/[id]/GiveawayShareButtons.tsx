"use client";

import React, { useEffect, useState } from "react";

/** Share targets for a giveaway; `from` tells the server logs which one brought a visitor. */
export function giveawayShareLinks(origin: string, publicId: string, amountKas: string) {
  const page = `${origin}/giveaways/${encodeURIComponent(publicId)}`;
  const text = `I just joined a free ${amountKas} KAS giveaway on Kaspa. Fair on-chain draw, no account needed 👇`;
  return {
    copy: `${page}?from=share-link`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(`${page}?from=share-tg`)}&text=${encodeURIComponent(text)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${page}?from=share-x`)}`,
  };
}

/** Telegram, X and copy-link sharing for a giveaway, offered right after someone enters. */
export function GiveawayShareButtons({
  amountKas,
  publicId,
}: {
  amountKas: string;
  publicId: string;
}) {
  // Share links need the absolute address, which only the browser knows here.
  const [origin, setOrigin] = useState<null | string>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return null;

  const links = giveawayShareLinks(origin, publicId, amountKas);

  return (
    <section aria-label="Share this giveaway" className="giveaway-share">
      <strong>Know someone who would want in?</strong>
      <div className="giveaway-share-buttons">
        <a className="btn btn-small" href={links.telegram} rel="noreferrer" target="_blank">
          Share on Telegram
        </a>
        <a className="btn btn-small" href={links.x} rel="noreferrer" target="_blank">
          Post on X
        </a>
        <button
          className="btn btn-small"
          onClick={() => {
            navigator.clipboard
              ?.writeText(links.copy)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2_000);
              })
              .catch(() => undefined);
          }}
          type="button"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </section>
  );
}
