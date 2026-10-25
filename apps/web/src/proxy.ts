import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy } from "./lib/content-security-policy";

// Nonce-based Content-Security-Policy for every page. Without 'unsafe-inline'
// an injected script cannot run, which is what keeps the bearer secrets this
// site handles (claim codes, manage tokens) out of reach. Next reads the nonce
// from the request header and puts it on its own <script> tags; Caddy only
// sets its fallback policy on responses that carry none (API, static files).
export function proxy(request: NextRequest) {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  const csp = buildContentSecurityPolicy({
    development: process.env.NODE_ENV === "development",
    nonce,
    pathname: request.nextUrl.pathname,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: no API routes, build assets, images or files with an extension.
      source: "/((?!api/|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)",
      missing: [
        { key: "next-router-prefetch", type: "header" },
        { key: "purpose", type: "header", value: "prefetch" },
      ],
    },
  ],
};
