"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";
export const SESSION_EVENT = "kaspa-actions:session";

type Session = { token: string; username: string };

function readSession(): Session {
  if (typeof window === "undefined") {
    return { token: "", username: "" };
  }

  return {
    token: window.sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
    username: window.sessionStorage.getItem(USERNAME_STORAGE_KEY) ?? "",
  };
}

function broadcastSessionChange() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

export function BrandNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<Session>({ token: "", username: "" });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSession(readSession());

    function refresh() {
      setSession(readSession());
    }

    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const signedIn = session.username.length > 0 && session.token.length > 0;

  // Primary links shown inline in the bar on desktop (≥1024px, where the bar
  // widens to match the content). On smaller screens these collapse into the
  // hamburger dropdown below.
  const inlineLinks = signedIn
    ? [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/my-links", label: "My links" },
        { href: "/my-profile", label: "My profile" },
        { href: "/stats", label: "Stats" },
      ]
    : [
        { href: "/what-is-kaspa", label: "What is Kaspa?" },
        { href: "/stats", label: "Stats" },
        { href: "/faq", label: "FAQ" },
        { href: "/try-it-out", label: "Try it out" },
      ];

  function signOut() {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(USERNAME_STORAGE_KEY);
    }
    setSession({ token: "", username: "" });
    setOpen(false);
    broadcastSessionChange();
    router.push("/sign-in");
  }

  return (
    <div className="brand-bar-actions">
      <nav className="brand-bar-links" aria-label="Primary">
        {inlineLinks.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`brand-bar-link${active ? " is-active" : ""}`}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          );
        })}
        {signedIn ? (
          <button
            className="brand-bar-link brand-bar-link-signout"
            onClick={signOut}
            type="button"
          >
            Sign out
          </button>
        ) : null}
      </nav>
      {signedIn ? (
        <Link className="signed-in-pill" href="/dashboard" title="Dashboard">
          <span className="signed-in-dot" aria-hidden="true" />
          <span className="signed-in-label">Signed in as</span>
          <span className="signed-in-name">{session.username}</span>
        </Link>
      ) : (
        <Link className="brand-bar-signin" href="/sign-in">
          Sign in
        </Link>
      )}
      <div className="nav-menu" ref={containerRef}>
        <button
          type="button"
          className="nav-toggle"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="nav-toggle-bar" aria-hidden="true" />
          <span className="nav-toggle-bar" aria-hidden="true" />
          <span className="nav-toggle-bar" aria-hidden="true" />
        </button>
        {open ? (
          <div className="nav-dropdown" role="menu">
            {!signedIn ? (
              <>
                <Link
                  className="nav-dropdown-item nav-dropdown-item-accent"
                  href="/sign-in"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  Sign in
                </Link>
                <Link
                  className="nav-dropdown-item"
                  href="/create-profile"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  Create profile
                </Link>
                <div className="nav-dropdown-divider" role="separator" />
              </>
            ) : null}
            {signedIn ? (
              <>
                <Link
                  className="nav-dropdown-item"
                  href="/my-profile"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  My profile
                </Link>
                <Link
                  className="nav-dropdown-item"
                  href="/my-links"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  My links
                </Link>
                <Link
                  className="nav-dropdown-item"
                  href="/dashboard"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  Dashboard
                </Link>
              </>
            ) : null}
            <Link
              className="nav-dropdown-item"
              href="/what-is-kaspa"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              What is Kaspa?
            </Link>
            <Link
              className="nav-dropdown-item"
              href="/stats"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Stats
            </Link>
            <Link
              className="nav-dropdown-item"
              href="/faq"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              FAQ
            </Link>
            {signedIn ? (
              <>
                <div className="nav-dropdown-divider" role="separator" />
                <button
                  type="button"
                  className="nav-dropdown-item nav-dropdown-item-danger"
                  role="menuitem"
                  onClick={signOut}
                >
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
