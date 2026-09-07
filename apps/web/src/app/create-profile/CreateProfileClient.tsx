"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { SESSION_EVENT } from "../BrandNav";

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

async function writeClipboardText(value: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through */
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export function CreateProfileClient({
  nextPath = "/dashboard",
  onContinue,
}: {
  nextPath?: string;
  onContinue?: (identity: { username: string; token: string }) => void;
}) {
  const Wrapper = onContinue ? "div" : "main";
  const Heading = onContinue ? "h2" : "h1";
  const [accessSaved, setAccessSaved] = useState(false);
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [issuedToken, setIssuedToken] = useState<null | string>(null);
  const [issuedUsername, setIssuedUsername] = useState<null | string>(null);
  const [copied, setCopied] = useState(false);

  // If already signed in, jump straight to /my-links.
  useEffect(() => {
    if (typeof window === "undefined" || onContinue) return;
    const storedUsername = window.sessionStorage.getItem(USERNAME_STORAGE_KEY) ?? "";
    const storedToken = window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
    if (storedUsername && storedToken) {
      router.replace(nextPath);
    }
  }, [router, nextPath, onContinue]);

  const submit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);
      setIssuedToken(null);

      try {
        const response = await fetch("/api/creators", {
          body: JSON.stringify({
            displayName: displayName || undefined,
            username,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = await response.json();
        if (!response.ok) {
          setError(body?.error?.message ?? "Could not create creator profile.");
          return;
        }
        writeSessionValue(USERNAME_STORAGE_KEY, body.creator.username);
        writeSessionValue(TOKEN_STORAGE_KEY, body.creatorToken);
        broadcastSessionChange();
        setIssuedToken(body.creatorToken);
        setIssuedUsername(body.creator.username);
      } catch {
        setError("Network error while creating creator profile.");
      } finally {
        setSubmitting(false);
      }
    },
    [displayName, username],
  );

  const copyToken = useCallback(async () => {
    if (!issuedToken) return;
    const ok = await writeClipboardText(issuedToken);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }, [issuedToken]);

  if (issuedToken && issuedUsername) {
    return (
      <Wrapper className={onContinue ? "giveaway-inline-auth" : "auth-layout"}>
        <section className="card card-accent auth-hero">
          <span className="label">Profile created</span>
          <Heading style={{ marginBottom: 6 }}>
            {onContinue ? "Save your access code" : "Save your creator token"}
          </Heading>
          <p className="muted" style={{ margin: 0 }}>
            {onContinue ? (
              "Save this code in your password manager. You need it to sign in again; we cannot recover it."
            ) : (
              <>
                This token is shown only once. Without it, you cannot sign back into the{" "}
                <code>{issuedUsername}</code> profile. Kaspa Links stores only a cryptographic hash,
                so we cannot read the token back or recover it later. Save it in a password manager
                now.
              </>
            )}
          </p>
        </section>

        <section className="card auth-form-card">
          <span className="label">{onContinue ? "Access code" : "Creator token"}</span>
          <p className="value-mono" style={{ marginTop: 8 }}>
            {issuedToken}
          </p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => void copyToken()} type="button">
              {copied ? "Copied" : onContinue ? "Copy access code" : "Copy token"}
            </button>
          </div>
        </section>

        <section className="card auth-note">
          {onContinue ? (
            <>
              <label className="giveaway-check">
                <input
                  type="checkbox"
                  checked={accessSaved}
                  onChange={(event) => setAccessSaved(event.target.checked)}
                />
                I saved my access code
              </label>
              <button
                className="btn btn-primary btn-block"
                type="button"
                disabled={!accessSaved}
                onClick={() => onContinue({ username: issuedUsername, token: issuedToken })}
              >
                Continue to giveaway
              </button>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                You&apos;re already signed in as <strong>{issuedUsername}</strong>. Once you&apos;ve
                saved the token, you&apos;re ready to spin up your first link.
              </p>
              <div className="row">
                <Link
                  className="btn btn-primary"
                  href={nextPath === "/dashboard" ? "/new-link" : nextPath}
                >
                  {nextPath.startsWith("/toccata-lab/giveaway")
                    ? "Continue to my giveaway"
                    : "Create your first link"}
                </Link>
                <Link className="btn" href="/dashboard">
                  Open dashboard
                </Link>
              </div>
            </>
          )}
        </section>
      </Wrapper>
    );
  }

  return (
    <Wrapper className={onContinue ? "giveaway-inline-auth" : "auth-layout"}>
      <section className="card card-accent auth-hero">
        <span className="label">Create profile</span>
        <Heading style={{ marginBottom: 6 }}>
          {onContinue ? "Create your profile" : "Start sharing Kaspa links"}
        </Heading>
        <p className="muted" style={{ margin: 0 }}>
          {onContinue ? (
            "Choose a public username for your giveaways."
          ) : (
            <>
              Pick a username for your public namespace (<code>/u/yourname</code>). We&apos;ll issue
              a one-time creator token — that&apos;s your only credential, so save it carefully. We
              store only a cryptographic hash and cannot read the token back later.
            </>
          )}
        </p>
      </section>

      <section className="card auth-form-card">
        <form className="row-stack" onSubmit={submit}>
          <div>
            <label className="label" htmlFor="create-username">
              Username
            </label>
            <input
              autoComplete="off"
              id="create-username"
              onChange={(event) => setUsername(event.target.value)}
              placeholder="yourname"
              required
              type="text"
              value={username}
            />
          </div>
          <details>
            <summary>Add a display name (optional)</summary>
            <div>
              <label className="label" htmlFor="create-display-name">
                Display name (optional)
              </label>
              <input
                id="create-display-name"
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Your display name"
                type="text"
                value={displayName}
              />
            </div>
          </details>
          <button className="btn btn-primary btn-block" disabled={submitting} type="submit">
            {submitting ? "Creating..." : "Create profile"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </section>

      {!onContinue ? (
        <section className="card card-muted auth-note">
          <p className="muted" style={{ margin: 0 }}>
            Already have a creator token? <Link href="/sign-in">Sign in</Link>.
          </p>
        </section>
      ) : null}
    </Wrapper>
  );
}
