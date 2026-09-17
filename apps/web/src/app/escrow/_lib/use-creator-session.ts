"use client";

import { useEffect, useState } from "react";

import { SESSION_EVENT } from "../../BrandNav";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";

export type CreatorSessionState = {
  hydrated: boolean;
  signedIn: boolean;
  token: string;
  username: string;
};

function readSessionValue(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Reads the existing KaspaLinks creator session; escrow links add no login of their own. */
export function useCreatorSession(): CreatorSessionState {
  const [state, setState] = useState<CreatorSessionState>({
    hydrated: false,
    signedIn: false,
    token: "",
    username: "",
  });

  useEffect(() => {
    function refresh() {
      const username = readSessionValue(USERNAME_STORAGE_KEY);
      const token = readSessionValue(TOKEN_STORAGE_KEY);
      setState({
        hydrated: true,
        signedIn: username.length > 0 && token.length > 0,
        token,
        username,
      });
    }

    refresh();
    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return state;
}
