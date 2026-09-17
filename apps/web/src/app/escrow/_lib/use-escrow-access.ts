"use client";

import { useEffect, useState } from "react";

import { useCreatorSession } from "./use-creator-session";

export type EscrowAccess = "checking" | "denied" | "granted";

/**
 * Asks the server whether the signed-in creator is allowlisted for the escrow
 * prototype. Signed-out visitors are denied without a request.
 */
export function useEscrowAccess(): EscrowAccess {
  const { hydrated, signedIn, token, username } = useCreatorSession();
  const [access, setAccess] = useState<EscrowAccess>("checking");

  useEffect(() => {
    if (!hydrated) return;
    if (!signedIn) {
      setAccess("denied");
      return;
    }

    setAccess("checking");
    const controller = new AbortController();
    fetch("/api/creator/escrow-access", {
      cache: "no-store",
      headers: { "x-creator-token": token, "x-creator-username": username },
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setAccess(response.ok ? "granted" : "denied");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAccess("denied");
      });
    return () => controller.abort();
  }, [hydrated, signedIn, token, username]);

  return access;
}
