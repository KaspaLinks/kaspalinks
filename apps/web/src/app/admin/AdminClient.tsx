"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";

const ACTION_TYPES = [
  {
    description: "Small support payment, often pay-what-you-want. Best for creator tips.",
    label: "Tip",
    value: "kaspa.tip",
  },
  {
    description: "Contribution to a project or cause. Usually variable-amount.",
    label: "Donation",
    value: "kaspa.donation",
  },
  {
    description: "Specific bill with a fixed amount the supporter must match exactly.",
    label: "Invoice",
    value: "kaspa.invoice",
  },
  {
    description: "Generic one-off transfer with a fixed amount and recipient.",
    label: "Transfer",
    value: "kaspa.transfer",
  },
] as const;

const TOKEN_STORAGE_KEY = "kaspa-actions:admin-token";

type CreatedAction = {
  publicId: string;
  type: string;
};

type RecentPaymentRequest = {
  actionPublicId: string;
  id: string;
};

function readStoredToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredToken(value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, value);
    } else {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function AdminClient() {
  const [token, setToken] = useState("");
  const [type, setType] = useState<(typeof ACTION_TYPES)[number]["value"]>("kaspa.tip");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [amountKas, setAmountKas] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [createdAction, setCreatedAction] = useState<null | CreatedAction>(null);
  const [recent, setRecent] = useState<RecentPaymentRequest[]>([]);
  const [mockConfirmStatus, setMockConfirmStatus] = useState<null | string>(null);
  const [manualMockId, setManualMockId] = useState("");

  useEffect(() => {
    setToken(readStoredToken());
  }, []);

  useEffect(() => {
    writeStoredToken(token);
  }, [token]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      setCreatedAction(null);

      if (!token) {
        setError("Admin token is required.");
        return;
      }

      setSubmitting(true);
      try {
        const trimmedAmount = normalizeLocalizedKasAmountInput(amountKas.trim());
        const response = await fetch("/api/admin/actions", {
          body: JSON.stringify({
            amountKas: trimmedAmount.length > 0 ? trimmedAmount : undefined,
            description: description || undefined,
            message: message || undefined,
            network: "mainnet",
            recipientAddress,
            title,
            type,
          }),
          headers: {
            "content-type": "application/json",
            "x-admin-token": token,
          },
          method: "POST",
        });
        const body = await response.json();
        if (!response.ok) {
          setError(body?.error?.message ?? "Could not create the link.");
          return;
        }
        setCreatedAction({
          publicId: body.action.publicId,
          type: body.action.type,
        });
      } catch {
        setError("Network error while creating the link.");
      } finally {
        setSubmitting(false);
      }
    },
    [token, type, title, description, message, amountKas, recipientAddress],
  );

  const createTestPaymentRequest = useCallback(async () => {
    if (!createdAction) return;
    setMockConfirmStatus(null);
    try {
      const response = await fetch(`/api/actions/${createdAction.publicId}/payment-requests`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        setMockConfirmStatus(body?.error?.message ?? "Could not create payment request.");
        return;
      }
      setRecent((current) => [
        { actionPublicId: createdAction.publicId, id: body.paymentRequest.id },
        ...current,
      ]);
      setMockConfirmStatus(`Created payment request ${body.paymentRequest.id}.`);
    } catch {
      setMockConfirmStatus("Network error while creating payment request.");
    }
  }, [createdAction]);

  const mockConfirm = useCallback(
    async (paymentRequestId: string) => {
      setMockConfirmStatus(null);
      if (!token) {
        setMockConfirmStatus("Admin token is required to mock-confirm.");
        return;
      }
      try {
        const response = await fetch(
          `/api/admin/payment-requests/${paymentRequestId}/mock-confirm`,
          {
            headers: { "x-admin-token": token },
            method: "POST",
          },
        );
        const body = await response.json();
        if (!response.ok) {
          setMockConfirmStatus(body?.error?.message ?? "Mock-confirm failed.");
          return;
        }
        setMockConfirmStatus(
          `Confirmed ${paymentRequestId}. Fake tx: ${body.paymentRequest.fakeTxId}.`,
        );
      } catch {
        setMockConfirmStatus("Network error during mock-confirm.");
      }
    },
    [token],
  );

  return (
    <main className="main-wide">
      <section className="card card-accent">
        <span className="label">Operator</span>
        <h1>Admin</h1>
        <p className="muted" style={{ margin: 0 }}>
          The admin token is stored in this tab&apos;s sessionStorage only. Close the tab to clear
          it. Never paste production tokens into a shared device.
        </p>
      </section>

      <section className="card">
        <label className="label" htmlFor="admin-token">
          Admin access token
        </label>
        <input
          autoComplete="off"
          id="admin-token"
          onChange={(event) => setToken(event.target.value)}
          placeholder="Bearer token"
          type="password"
          value={token}
        />
        <p className="muted" style={{ marginTop: 8 }}>
          Configured via the <code>ADMIN_ACCESS_TOKEN</code> environment variable.
        </p>
      </section>

      <section className="card">
        <h2>Create a link</h2>
        <form className="row-stack" onSubmit={handleSubmit}>
          <div>
            <label className="label" htmlFor="action-title">
              Title
            </label>
            <input
              id="action-title"
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              required
              type="text"
              value={title}
            />
          </div>
          <div>
            <label className="label" htmlFor="action-type">
              Type
            </label>
            <select
              id="action-type"
              onChange={(event) =>
                setType(event.target.value as (typeof ACTION_TYPES)[number]["value"])
              }
              value={type}
            >
              {ACTION_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="muted" style={{ marginTop: 6 }}>
              {ACTION_TYPES.find((option) => option.value === type)?.description}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="action-amount">
              Amount (KAS) — optional
            </label>
            <input
              id="action-amount"
              inputMode="decimal"
              onChange={(event) => setAmountKas(event.target.value)}
              placeholder='e.g. 10 — leave empty for "pay what you want"'
              type="text"
              value={amountKas}
            />
            <p className="muted" style={{ marginTop: 6 }}>
              Leave blank for variable-amount links (tips, donations). Set a value for invoices and
              fixed transfers.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="action-recipient">
              Recipient address
            </label>
            <input
              id="action-recipient"
              onChange={(event) => setRecipientAddress(event.target.value)}
              placeholder="kaspa:... or kaspatest:..."
              required
              type="text"
              value={recipientAddress}
            />
          </div>
          <div>
            <label className="label" htmlFor="action-description">
              Description (optional)
            </label>
            <textarea
              id="action-description"
              maxLength={280}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          <div>
            <label className="label" htmlFor="action-message">
              Message (optional)
            </label>
            <textarea
              id="action-message"
              maxLength={280}
              onChange={(event) => setMessage(event.target.value)}
              value={message}
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={submitting} type="submit">
            {submitting ? "Creating..." : "Create link"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>

      {createdAction ? (
        <section className="card">
          <h2>Link created</h2>
          <p>
            Public ID: <span className="value-mono">{createdAction.publicId}</span>
          </p>
          <p>
            <Link className="btn btn-block" href={`/a/${createdAction.publicId}`}>
              Open link page
            </Link>
          </p>
          <p>
            <button className="btn btn-block" onClick={createTestPaymentRequest} type="button">
              Create test payment request
            </button>
          </p>
        </section>
      ) : null}

      <section className="card">
        <h2>Mock-confirm by ID</h2>
        <p className="muted">
          Paste the &ldquo;Payment request ID&rdquo; shown on the public link page to confirm a
          request that was generated by a supporter. Requires
          <code> MOCK_CONFIRM_ENABLED=true</code> on the server.
        </p>
        <div className="row-stack">
          <input
            autoComplete="off"
            onChange={(event) => setManualMockId(event.target.value.trim())}
            placeholder="cmp..."
            type="text"
            value={manualMockId}
          />
          <button
            className="btn btn-primary btn-block"
            disabled={!manualMockId}
            onClick={() => {
              if (manualMockId) {
                void mockConfirm(manualMockId);
              }
            }}
            type="button"
          >
            Mock-confirm this payment request
          </button>
          {mockConfirmStatus ? (
            <p className="muted" style={{ marginTop: 4 }}>
              {mockConfirmStatus}
            </p>
          ) : null}
        </div>
      </section>

      {recent.length > 0 ? (
        <section className="card">
          <h2>Recent payment requests</h2>
          <p className="muted">
            Mock-confirm only works when <code>MOCK_CONFIRM_ENABLED=true</code> is set on the
            server.
          </p>
          <ul style={{ paddingLeft: 18 }}>
            {recent.map((request) => (
              <li key={request.id} style={{ marginBottom: 8 }}>
                <div className="value-mono" style={{ marginBottom: 4 }}>
                  {request.id}
                </div>
                <button className="btn" onClick={() => mockConfirm(request.id)} type="button">
                  Mock-confirm
                </button>
              </li>
            ))}
          </ul>
          {mockConfirmStatus ? (
            <p className="muted" style={{ marginTop: 8 }}>
              {mockConfirmStatus}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="card card-muted">
        <h2>Reminder</h2>
        <ul style={{ margin: 0 }}>
          <li>Kaspa Links is non-custodial — it never holds funds.</li>
          <li>Payments go directly from the supporter wallet to the recipient.</li>
          <li>
            Status flips to CONFIRMED via on-chain indexer detection. Mock-confirm is available as a
            test-mode shortcut when <code>MOCK_CONFIRM_ENABLED=true</code>.
          </li>
        </ul>
      </section>
    </main>
  );
}
