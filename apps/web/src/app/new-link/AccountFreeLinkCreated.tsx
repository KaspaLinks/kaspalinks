"use client";

import Link from "next/link";
import { useState } from "react";

export type AccountFreeCreatedLink = {
  manageUrl: string;
  savedInBrowser: boolean;
  shareUrl: string;
  title: string;
};

async function copy(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shown once a payment link exists without an account. The manage link is the
 * only key to it, so it is shown right here, next to the link to share.
 */
export function AccountFreeLinkCreated({
  link,
  onCreateAnother,
}: {
  link: AccountFreeCreatedLink;
  onCreateAnother(): void;
}) {
  const [copied, setCopied] = useState<"manage" | "share" | null>(null);

  async function copyValue(kind: "manage" | "share", value: string) {
    if (await copy(value)) {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    }
  }

  return (
    <section className="card card-accent account-free-created" aria-live="polite">
      <span className="label">Link ready</span>
      <h1 className="form-section-heading">{link.title}</h1>

      <div className="account-free-created-block">
        <strong>Share this link</strong>
        <p className="value-mono account-free-url">{link.shareUrl}</p>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={() => void copyValue("share", link.shareUrl)}
            type="button"
          >
            {copied === "share" ? "Copied" : "Copy link"}
          </button>
          <a className="btn" href={link.shareUrl} rel="noreferrer" target="_blank">
            Open
          </a>
        </div>
      </div>

      <div className="account-free-created-block account-free-created-private">
        <strong>Your private manage link</strong>
        <p className="muted">
          See payments, pause or delete this link. Anyone with this link can do the same, so keep it
          to yourself.{" "}
          {link.savedInBrowser
            ? "It is also saved in this browser."
            : "This browser could not save it, so copy it now."}
        </p>
        <p className="value-mono account-free-url">{link.manageUrl}</p>
        <div className="row">
          <button
            className="btn"
            onClick={() => void copyValue("manage", link.manageUrl)}
            type="button"
          >
            {copied === "manage" ? "Copied" : "Copy manage link"}
          </button>
        </div>
      </div>

      <div className="account-free-created-cta">
        <p>
          <strong>Keep all your links in one place.</strong> With a free account you see them on
          every device and can get payment alerts in Telegram. Links from this browser move in with
          one click.
        </p>
        <div className="row">
          <Link className="btn" href="/create-profile?next=%2Fmy-links">
            Create free account
          </Link>
          <button className="btn" onClick={onCreateAnother} type="button">
            Create another link
          </button>
        </div>
      </div>
    </section>
  );
}
