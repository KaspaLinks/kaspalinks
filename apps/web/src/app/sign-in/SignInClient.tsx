"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { SESSION_EVENT } from "../BrandNav";
import { sanitizeInternalNextPath } from "@/lib/internal-next-path";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";

function writeSessionValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

function broadcastSessionChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

function readRequestedDestination(): string {
  if (typeof window === "undefined") return "/dashboard";
  return sanitizeInternalNextPath(new URLSearchParams(window.location.search).get("next"));
}

export function SignInClient() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<null | string>(null);

  // If already signed in, jump straight to /my-links.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedUsername = window.sessionStorage.getItem(USERNAME_STORAGE_KEY) ?? "";
    const storedToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
    if (storedUsername && storedToken) {
      router.replace(readRequestedDestination());
    }
  }, [router]);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/creators/login", {
          body: JSON.stringify({ token, username }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = await response.json();
        if (!response.ok) {
          setError(body?.error?.message ?? "Invalid token or username.");
          return;
        }
        writeSessionValue(USERNAME_STORAGE_KEY, body.creator.username);
        writeSessionValue(TOKEN_STORAGE_KEY, token);
        broadcastSessionChange();
        router.push(readRequestedDestination());
      } catch {
        setError("Network error during sign in.");
      } finally {
        setSubmitting(false);
      }
    },
    [router, token, username],
  );

  return (
    <main className="auth-layout">
      <section className="card card-accent auth-hero">
        <span className="label">Creator sign in</span>
        <h1 style={{ marginBottom: 6 }}>Welcome back</h1>
        <p className="muted" style={{ margin: 0 }}>
          Sign in with the username and one-time token you saved when you created your profile. The
          token stays in this tab&apos;s sessionStorage only. Kaspa Links stores only a
          cryptographic hash, so we cannot retrieve a lost token later.
        </p>
      </section>

      <section className="card auth-form-card">
        <form className="row-stack" onSubmit={submit}>
          <div>
            <label className="label" htmlFor="signin-username">
              Username
            </label>
            <input
              autoComplete="username"
              id="signin-username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="yourname"
              required
              type="text"
              value={username}
            />
          </div>
          <div>
            <label className="label" htmlFor="signin-token">
              Creator token
            </label>
            <input
              autoComplete="current-password"
              id="signin-token"
              onChange={(event) => setToken(event.target.value)}
              placeholder="ka_creator_..."
              required
              type="password"
              value={token}
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={submitting} type="submit">
            {submitting ? "Signing in..." : "Sign in"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>

      <section className="card card-muted auth-note">
        <p className="muted" style={{ margin: 0 }}>
          New here? <Link href="/create-profile">Create a creator profile</Link> — it takes seconds,
          no email required.
        </p>
      </section>
    </main>
  );
}
