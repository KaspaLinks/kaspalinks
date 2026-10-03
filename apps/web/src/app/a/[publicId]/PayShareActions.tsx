"use client";

import { useState } from "react";

import { writeClipboardText } from "@/lib/clipboard";
import { buildPayShareUrl } from "@/lib/growth-prompts";
import { buildPayShareText, buildXIntentUrl } from "@/lib/share-text";

type Fallback = { text: string; url: string };

/**
 * Lets a payer share the creator's public page. The URL is rebuilt from the
 * pathname at click time, so no query string or fragment ever travels with it.
 */
export function PayShareActions({ title }: { title: string }) {
  const [fallback, setFallback] = useState<Fallback | null>(null);
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = buildPayShareUrl({
      origin: window.location.origin,
      pathname: window.location.pathname,
    });
    if (!url) return;
    const text = buildPayShareText({ title });

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, title, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    setFallback({ text, url });
  }

  async function copy(url: string) {
    if (await writeClipboardText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div className="pay-share-actions">
      {fallback ? (
        <>
          <a
            className="btn"
            href={buildXIntentUrl({ text: fallback.text, url: fallback.url })}
            rel="noopener noreferrer"
            target="_blank"
          >
            Post on X
          </a>
          <button className="btn" onClick={() => void copy(fallback.url)} type="button">
            {copied ? "Link copied" : "Copy link"}
          </button>
        </>
      ) : (
        <button className="btn" onClick={() => void share()} type="button">
          Share this page
        </button>
      )}
    </div>
  );
}
