"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { writeClipboardText } from "@/lib/clipboard";

const TOKEN_KEY = "kaspa-actions:creator-token";
const USERNAME_KEY = "kaspa-actions:creator-username";

type Settings = {
  aiConsentAt: null | string;
  aiEnabled: boolean;
  defaultRecipientAddress: null | string;
  telegramBetaEnabled: boolean;
  telegramBotUsername: null | string;
  telegramConnection: null | {
    blockedAt: null | string;
    connectedAt: string;
    disabledReason: null | string;
    notificationsEnabled: boolean;
    supporterDetailsEnabled: boolean;
  };
  timezone: string;
  waitlistAt: null | string;
};

function sessionHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-creator-token": window.sessionStorage.getItem(TOKEN_KEY) ?? "",
    "x-creator-username": window.sessionStorage.getItem(USERNAME_KEY) ?? "",
  };
}

export function AgentClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [connect, setConnect] = useState<null | { code: string; deepLink: null | string }>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const load = useCallback(async () => {
    const token = window.sessionStorage.getItem(TOKEN_KEY) ?? "";
    const username = window.sessionStorage.getItem(USERNAME_KEY) ?? "";
    setSignedIn(Boolean(token && username));
    if (!token || !username) return;
    const response = await fetch("/api/creator/agent/settings", { headers: sessionHeaders() });
    const body = (await response.json()) as { error?: { message: string }; settings?: Settings };
    if (!response.ok || !body.settings)
      throw new Error(body.error?.message ?? "Agent settings failed.");
    setSettings(body.settings);
    setAddress(body.settings.defaultRecipientAddress ?? "");
    setTimezone(body.settings.timezone);
  }, []);

  useEffect(() => {
    void load().catch((error) => setMessage((error as Error).message));
  }, [load]);

  useEffect(() => {
    if (!connect || settings?.telegramConnection) return;
    const timer = window.setInterval(() => {
      void load().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [connect, load, settings?.telegramConnection]);

  async function mutate(path: string, method: "DELETE" | "PATCH" | "POST", body?: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, {
        body: body ? JSON.stringify(body) : undefined,
        headers: sessionHeaders(),
        method,
      });
      const payload = (await response.json()) as Record<string, unknown> & {
        error?: { message: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? "Action could not be completed.");
      return payload;
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    try {
      await mutate("/api/creator/agent/settings", "PATCH", {
        defaultRecipientAddress: address.trim() || null,
        timezone,
      });
      await load();
      setMessage("Agent settings saved.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  async function updateToggle(
    key: "aiConsent" | "notificationsEnabled" | "supporterDetailsEnabled",
    value: boolean,
  ) {
    try {
      await mutate("/api/creator/agent/settings", "PATCH", { [key]: value });
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  if (!signedIn) {
    return (
      <main className="main-wide agent-page">
        <section className="card agent-hero">
          <span className="label">KaspaLinks Agent</span>
          <h1>Sign in to manage Agent access.</h1>
          <Link className="btn btn-primary" href="/sign-in">
            Sign in
          </Link>
        </section>
      </main>
    );
  }

  if (!settings) {
    return (
      <main className="main-wide agent-page">
        <p className="muted">Loading Agent settings...</p>
      </main>
    );
  }

  return (
    <main className="main-wide agent-page">
      <header className="agent-hero">
        <span className="label">KaspaLinks Agent</span>
        <h1>Manage links and payment alerts from Telegram.</h1>
        <p>Closed beta. The Agent never signs transactions or handles wallet keys.</p>
      </header>

      {message ? (
        <div className="notice" role="status">
          {message}
        </div>
      ) : null}

      {!settings.telegramBetaEnabled ? (
        <section className="card agent-waitlist">
          <span className="label">Closed beta</span>
          <h2>{settings.waitlistAt ? "You are on the waitlist" : "Join the Agent waitlist"}</h2>
          <p className="muted">Access is enabled creator by creator during the Telegram beta.</p>
          {!settings.waitlistAt ? (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => {
                void mutate("/api/creator/agent/waitlist", "POST")
                  .then(() => load())
                  .catch((error) => setMessage((error as Error).message));
              }}
              type="button"
            >
              Join waitlist
            </button>
          ) : null}
        </section>
      ) : (
        <div className="agent-settings-grid">
          <section className="card agent-settings-panel">
            <span className="label">Payment defaults</span>
            <h2>Agent settings</h2>
            <label className="field-label" htmlFor="agent-address">
              Default recipient address
            </label>
            <input
              id="agent-address"
              onChange={(event) => setAddress(event.target.value)}
              placeholder="kaspa:..."
              value={address}
            />
            <label className="field-label" htmlFor="agent-timezone">
              IANA timezone
            </label>
            <input
              id="agent-timezone"
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Berlin"
              value={timezone}
            />
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void saveSettings()}
              type="button"
            >
              Save settings
            </button>
          </section>

          <section className="card agent-settings-panel">
            <span className="label">Telegram</span>
            <h2>{settings.telegramConnection ? "Connected" : "Connect Telegram"}</h2>
            {settings.telegramConnection ? (
              <>
                <p
                  className={
                    settings.telegramConnection.blockedAt ? "status-error" : "status-success"
                  }
                >
                  {settings.telegramConnection.blockedAt
                    ? (settings.telegramConnection.disabledReason ?? "Delivery is disabled.")
                    : "Private chat connected."}
                </p>
                <label className="agent-toggle">
                  <input
                    checked={settings.telegramConnection.notificationsEnabled}
                    onChange={(event) =>
                      void updateToggle("notificationsEnabled", event.target.checked)
                    }
                    type="checkbox"
                  />
                  Payment notifications
                </label>
                <label className="agent-toggle">
                  <input
                    checked={settings.telegramConnection.supporterDetailsEnabled}
                    onChange={(event) =>
                      void updateToggle("supporterDetailsEnabled", event.target.checked)
                    }
                    type="checkbox"
                  />
                  Include opted-in public supporter details
                </label>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    void mutate("/api/creator/agent/connection", "DELETE")
                      .then(() => {
                        setConnect(null);
                        return load();
                      })
                      .catch((error) => setMessage((error as Error).message));
                  }}
                  type="button"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <p className="muted">Generate a one-time code. It expires after ten minutes.</p>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => {
                    void mutate("/api/creator/agent/connection-code", "POST")
                      .then((result) =>
                        setConnect(result as { code: string; deepLink: null | string }),
                      )
                      .catch((error) => setMessage((error as Error).message));
                  }}
                  type="button"
                >
                  Generate connection code
                </button>
                {connect ? (
                  <div className="agent-connect-code">
                    <p className="muted">
                      In Telegram, tap <strong>Start</strong>. If no Start button appears, paste
                      this command into the private bot chat:
                    </p>
                    <code>{`/connect ${connect.code}`}</code>
                    <div className="button-row">
                      <button
                        className="btn"
                        onClick={() => {
                          void writeClipboardText(`/connect ${connect.code}`).then((copied) =>
                            setMessage(
                              copied
                                ? "Connection command copied. Paste it into the private Telegram chat."
                                : "Copy failed. Select the connection command manually.",
                            ),
                          );
                        }}
                        type="button"
                      >
                        Copy connection command
                      </button>
                      {connect.deepLink ? (
                        <a className="btn" href={connect.deepLink} rel="noreferrer" target="_blank">
                          Open @{settings.telegramBotUsername}
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </section>

          {settings.aiEnabled ? (
            <section className="card agent-settings-panel agent-ai-panel">
              <span className="label">AI intent beta</span>
              <h2>Natural language</h2>
              <p className="muted">
                Short German or English messages are sent to OpenAI with response storage disabled.
                Provider abuse-monitoring retention may still apply. KaspaLinks stores only the
                structured result and usage metadata, never your prompt or model response.
              </p>
              <label className="agent-toggle">
                <input
                  checked={Boolean(settings.aiConsentAt)}
                  onChange={(event) => void updateToggle("aiConsent", event.target.checked)}
                  type="checkbox"
                />
                I agree to OpenAI processing for Agent messages
              </label>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
