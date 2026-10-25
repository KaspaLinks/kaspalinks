"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useCreatorSession } from "../../use-creator-session";
import { moveAccountFreeEntriesIntoAccount } from "@/lib/account-free-adopt";
import {
  addAccountFreeEntry,
  readAccountFreeEntries,
  removeAccountFreeEntries,
  type AccountFreePaymentEntry,
} from "@/lib/account-free-store";

type ManagedLink = {
  createdAt: string;
  disabled: boolean;
  publicId: string;
  sharePath: string;
  title: string;
  type: string;
};

type ManagedPayments = {
  confirmedCount: number;
  recent: {
    amountKas: null | string;
    confirmedAt: null | string;
    supporterMessage: null | string;
    supporterName: null | string;
    txId: null | string;
  }[];
  totalKas: string;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "deleted" }
  | { kind: "error"; message: string }
  | { kind: "ready"; link: ManagedLink; payments: ManagedPayments };

const TYPE_LABELS: Record<string, string> = {
  "kaspa.donation": "Donation",
  "kaspa.goal": "Goal",
  "kaspa.invoice": "Invoice",
  "kaspa.tip": "Tip",
  "kaspa.transfer": "Fixed amount",
};

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function readTokenFromFragment(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token")?.trim() ?? "";
}

/** The private manage page of a payment link created without an account. */
export function ManageLinkClient({ publicId }: { publicId: string }) {
  const router = useRouter();
  const session = useCreatorSession();
  const [manageToken, setManageToken] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const fromFragment = readTokenFromFragment();
    if (fromFragment) {
      setManageToken(fromFragment);
      return;
    }
    let cancelled = false;
    void readAccountFreeEntries().then((entries) => {
      if (cancelled) return;
      const stored = entries.find(
        (entry): entry is AccountFreePaymentEntry =>
          entry.kind === "payment" && entry.publicId === publicId,
      );
      setManageToken(stored?.manageToken ?? "");
      if (!stored) setState({ kind: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  const load = useCallback(async () => {
    if (!manageToken) return;
    try {
      const response = await fetch(`/api/actions/${encodeURIComponent(publicId)}/manage`, {
        headers: { "x-manage-token": manageToken },
      });
      if (response.status === 404) {
        setState({ kind: "missing" });
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        setState({ kind: "error", message: body?.error?.message ?? "Could not load this link." });
        return;
      }
      const link = body.action as ManagedLink;
      setState({ kind: "ready", link, payments: body.payments as ManagedPayments });
      // Opening the manage link on another device adds it to that browser's list too.
      void addAccountFreeEntry({
        createdAt: link.createdAt,
        kind: "payment",
        manageToken,
        publicId: link.publicId,
        title: link.title,
        type: link.type,
      }).then((saved) => {
        // Once this browser keeps the token sealed, it leaves the address bar
        // and the history. Without storage the link stays, as the only way back.
        if (saved && window.location.hash.includes("token=")) {
          window.history.replaceState(
            null,
            "",
            `${window.location.pathname}${window.location.search}`,
          );
        }
      });
    } catch {
      setState({ kind: "error", message: "Network error while loading this link." });
    }
  }, [manageToken, publicId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setDisabled(disabled: boolean) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/actions/${encodeURIComponent(publicId)}/manage`, {
        body: JSON.stringify({ disabled }),
        headers: { "content-type": "application/json", "x-manage-token": manageToken },
        method: "PATCH",
      });
      if (!response.ok) {
        setNotice("Could not change the link. Try again.");
        return;
      }
      await load();
      setNotice(disabled ? "Link paused. Nobody can pay it now." : "Link active again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteLink() {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/actions/${encodeURIComponent(publicId)}/manage`, {
        headers: { "x-manage-token": manageToken },
        method: "DELETE",
      });
      if (!response.ok) {
        setNotice("Could not delete the link. Try again.");
        return;
      }
      removeAccountFreeEntries([{ kind: "payment", publicId }]);
      setState({ kind: "deleted" });
    } finally {
      setBusy(false);
    }
  }

  async function moveIntoAccount() {
    setBusy(true);
    setNotice("");
    try {
      const result = await moveAccountFreeEntriesIntoAccount(
        session,
        (await readAccountFreeEntries()).filter(
          (entry) => entry.kind === "payment" && entry.publicId === publicId,
        ),
      );
      if (result.moved === 0) {
        setNotice("This link could not be moved. It may already belong to an account.");
        return;
      }
      router.push("/my-links");
    } catch {
      setNotice("Could not move the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <main className="main-wide">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading…
          </p>
        </section>
      </main>
    );
  }

  if (state.kind === "missing" || state.kind === "deleted" || state.kind === "error") {
    return (
      <main className="main-wide">
        <section className="card">
          <span className="label">Manage link</span>
          <h1 className="form-section-heading">
            {state.kind === "deleted"
              ? "Link deleted"
              : state.kind === "error"
                ? "Could not load this link"
                : "This link is not managed here"}
          </h1>
          <p className="muted">
            {state.kind === "deleted"
              ? "Nobody can pay it anymore. Payments that already arrived stay in your wallet."
              : state.kind === "error"
                ? state.message
                : "Open the complete private manage link you saved. If you moved this link into an account, manage it in My Links."}
          </p>
          <div className="row">
            <Link className="btn" href="/my-links">
              My Links
            </Link>
            <Link className="btn" href="/new-link">
              Create a link
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const { link, payments } = state;
  const shareUrl = `${window.location.origin}${link.sharePath}`;

  return (
    <main className="main-wide manage-link-page">
      <section className="card card-accent">
        <span className="label">
          {TYPE_LABELS[link.type] ?? "Payment link"} · {link.disabled ? "Paused" : "Active"}
        </span>
        <h1 className="form-section-heading">{link.title}</h1>
        <p className="value-mono account-free-url">{shareUrl}</p>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={() =>
              void navigator.clipboard
                .writeText(shareUrl)
                .then(() => setNotice("Link copied."))
                .catch(() => undefined)
            }
            type="button"
          >
            Copy link
          </button>
          <a className="btn" href={shareUrl} rel="noreferrer" target="_blank">
            Open
          </a>
        </div>
      </section>

      <section className="card">
        <span className="label">Payments</span>
        <h2 className="form-section-heading">
          {payments.confirmedCount === 0
            ? "No payments yet"
            : `${payments.totalKas} KAS from ${payments.confirmedCount} ${
                payments.confirmedCount === 1 ? "payment" : "payments"
              }`}
        </h2>
        {payments.recent.length > 0 ? (
          <ul className="manage-link-payments">
            {payments.recent.map((payment, index) => (
              <li key={payment.txId ?? index}>
                <strong>{payment.amountKas ?? "?"} KAS</strong>
                <span className="muted">
                  {payment.confirmedAt ? dateFormat.format(new Date(payment.confirmedAt)) : ""}
                  {payment.supporterName ? ` · ${payment.supporterName}` : ""}
                </span>
                {payment.supporterMessage ? <p>{payment.supporterMessage}</p> : null}
                {payment.txId ? (
                  <a
                    href={`https://kaspa.stream/transactions/${payment.txId}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View transaction
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Confirmed payments appear here. They go straight to your wallet.</p>
        )}
      </section>

      <section className="card">
        <span className="label">Settings</span>
        <div className="row">
          <button
            className="btn"
            disabled={busy}
            onClick={() => void setDisabled(!link.disabled)}
            type="button"
          >
            {link.disabled ? "Activate link" : "Pause link"}
          </button>
          {confirmDelete ? (
            <>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void deleteLink()}
                type="button"
              >
                Delete for good
              </button>
              <button className="btn" onClick={() => setConfirmDelete(false)} type="button">
                Keep link
              </button>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirmDelete(true)} type="button">
              Delete link
            </button>
          )}
        </div>
        {notice ? (
          <p className="muted" role="status">
            {notice}
          </p>
        ) : null}
      </section>

      <section className="card card-muted account-free-created-cta">
        {session.signedIn ? (
          <>
            <p>
              Signed in as <strong>{session.username}</strong>. Move this link into your account to
              manage it with your other links.
            </p>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void moveIntoAccount()}
              type="button"
            >
              Move into my account
            </button>
          </>
        ) : (
          <>
            <p>
              <strong>Keep all your links in one place.</strong> With a free account you see them on
              every device. Links from this browser move in with one click.
            </p>
            <Link className="btn" href="/create-profile?next=%2Fmy-links">
              Create free account
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
