"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { moveAccountFreeEntriesIntoAccount } from "@/lib/account-free-adopt";
import {
  ACCOUNT_FREE_STORE_EVENT,
  ACCOUNT_FREE_STORE_KEY,
  readAccountFreeEntries,
  type AccountFreeEntry,
} from "@/lib/account-free-store";
import { writeClipboardText } from "@/lib/clipboard";

const TYPE_LABELS: Record<string, string> = {
  "kaspa.donation": "Donation",
  "kaspa.goal": "Goal",
  "kaspa.invoice": "Invoice",
  "kaspa.tip": "Tip",
  "kaspa.transfer": "Fixed amount",
};

function useAccountFreeEntries(): AccountFreeEntry[] {
  const [entries, setEntries] = useState<AccountFreeEntry[]>([]);
  useEffect(() => {
    const refresh = () => setEntries(readAccountFreeEntries());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === ACCOUNT_FREE_STORE_KEY) refresh();
    };
    refresh();
    window.addEventListener(ACCOUNT_FREE_STORE_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ACCOUNT_FREE_STORE_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return entries;
}

/**
 * Links this browser created without an account. Signed out, they are listed
 * with their private manage or claim links; signed in, they can move into the
 * account with one click.
 */
export function AccountFreeLinksPanel({
  onMoved,
  session,
}: {
  onMoved?(): void;
  session: null | { token: string; username: string };
}) {
  const entries = useAccountFreeEntries();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  if (entries.length === 0) return null;

  async function moveAll() {
    if (!session) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await moveAccountFreeEntriesIntoAccount(session, entries);
      setNotice(
        result.remaining === 0
          ? `Moved ${result.moved} ${result.moved === 1 ? "link" : "links"} into your account.`
          : `Moved ${result.moved}. ${result.remaining} could not be moved; they may be deleted or belong to another account.`,
      );
      if (result.moved > 0) onMoved?.();
    } catch {
      setNotice("Could not move the links. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <section className="card account-free-panel" aria-live="polite">
        <span className="label">Created in this browser</span>
        <h2 className="form-section-heading">
          {entries.length} {entries.length === 1 ? "link is" : "links are"} not in your account yet
        </h2>
        <p className="muted">
          You created {entries.length === 1 ? "it" : "them"} without signing in. Move{" "}
          {entries.length === 1 ? "it" : "them"} here to see payments and status with your other
          links. Shared links keep working unchanged.
        </p>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void moveAll()}
          type="button"
        >
          {busy ? "Moving…" : "Move into my account"}
        </button>
        {notice ? <p className="muted">{notice}</p> : null}
      </section>
    );
  }

  return (
    <section className="card account-free-panel">
      <span className="label">Created in this browser</span>
      <h2 className="form-section-heading">Your links without an account</h2>
      <p className="muted">
        Saved only in this browser. Keep the private links safe: whoever has them can manage or
        claim.
      </p>
      <ul className="account-free-list">
        {entries.map((entry) => (
          <li key={entry.kind === "payment" ? entry.publicId : entry.linkKey}>
            <div>
              <strong>{entry.title}</strong>
              <span className="muted">
                {entry.kind === "payment"
                  ? (TYPE_LABELS[entry.type] ?? "Payment link")
                  : `Claim link · ${entry.amountKas} KAS`}
              </span>
            </div>
            {entry.kind === "payment" ? (
              <Link
                className="btn btn-sm"
                href={`/manage/${encodeURIComponent(entry.publicId)}#token=${encodeURIComponent(entry.manageToken)}`}
              >
                Manage
              </Link>
            ) : (
              <button
                className="btn btn-sm"
                onClick={() =>
                  void writeClipboardText(entry.claimUrl).then((ok) =>
                    setNotice(ok ? "Claim link copied." : "Could not copy."),
                  )
                }
                type="button"
              >
                Copy claim link
              </button>
            )}
          </li>
        ))}
      </ul>
      {notice ? <p className="muted">{notice}</p> : null}
    </section>
  );
}
