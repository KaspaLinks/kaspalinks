"use client";

import { useEffect, type ReactNode } from "react";

import NotFound from "../../not-found";
import { useEscrowAccess } from "../_lib/use-escrow-access";

/**
 * Shows the escrow prototype only to allowlisted creators. Everyone else sees
 * the regular "not found" page, so the prototype stays invisible.
 */
export function EscrowAccessGate({ children, title }: { children: ReactNode; title: string }) {
  const access = useEscrowAccess();

  useEffect(() => {
    if (access === "granted") document.title = `${title} · Kaspa Links`;
  }, [access, title]);

  if (access === "denied") {
    return <NotFound />;
  }

  if (access === "checking") {
    return (
      <main className="main-wide escrow-layout">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading...
          </p>
        </section>
      </main>
    );
  }

  return children;
}
