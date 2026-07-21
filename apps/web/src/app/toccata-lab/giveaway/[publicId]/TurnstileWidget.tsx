"use client";

import { useEffect, useRef } from "react";

type TurnstileApi = {
  remove(widgetId: string): void;
  render(
    container: HTMLElement,
    options: {
      action: string;
      appearance: "interaction-only";
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
      sitekey: string;
      size: "flexible";
      theme: "dark";
    },
  ): string;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileWidget({
  action,
  onError,
  onToken,
  resetKey,
  siteKey,
}: {
  action: string;
  onError(): void;
  onToken(token: null | string): void;
  resetKey: number;
  siteKey: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onErrorRef = useRef(onError);
  const onTokenRef = useRef(onToken);

  onErrorRef.current = onError;
  onTokenRef.current = onToken;

  useEffect(() => {
    let disposed = false;
    let widgetId: null | string = null;
    const container = containerRef.current;
    if (!container) return;

    onTokenRef.current(null);

    const renderWidget = () => {
      if (disposed || widgetId || !window.turnstile || !containerRef.current) return;
      widgetId = window.turnstile.render(containerRef.current, {
        action,
        appearance: "interaction-only",
        callback: (token) => onTokenRef.current(token),
        "error-callback": () => {
          onTokenRef.current(null);
          onErrorRef.current();
        },
        "expired-callback": () => onTokenRef.current(null),
        sitekey: siteKey,
        size: "flexible",
        theme: "dark",
      });
    };

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (window.turnstile) {
      renderWidget();
    } else if (script) {
      script.addEventListener("load", renderWidget);
    } else {
      script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.addEventListener("load", renderWidget);
      script.addEventListener("error", () => onErrorRef.current());
      document.head.appendChild(script);
    }

    return () => {
      disposed = true;
      script?.removeEventListener("load", renderWidget);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      container.replaceChildren();
    };
  }, [action, resetKey, siteKey]);

  return <div className="turnstile-widget" ref={containerRef} />;
}
