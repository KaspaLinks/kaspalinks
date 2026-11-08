"use client";

import React, { useState } from "react";

/** Copies "@username" so it can be pasted into Telegram's search. */
export function CopyBotUsername({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);
  const handle = `@${username}`;
  return (
    <span className="bot-handle">
      <code>{handle}</code>
      <button
        className="btn btn-small"
        onClick={() => {
          navigator.clipboard
            ?.writeText(handle)
            .then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2_000);
            })
            .catch(() => undefined);
        }}
        type="button"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
