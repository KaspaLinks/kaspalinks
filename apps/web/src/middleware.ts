import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Strict, nonce-based Content-Security-Policy for claimable-link routes. The
// claim/refund pages hold bearer-style codes in the URL fragment, so we drop
// script-src 'unsafe-inline' here and require a per-request nonce instead.
// 'unsafe-eval' stays because the kaspa-wasm signer needs it. This is scoped to
// claimable routes only so the broader public site keeps the existing Caddy CSP.
export function middleware(request: NextRequest) {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Next reads the request Content-Security-Policy header to find the nonce and
  // applies it to its own <script> tags during rendering.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/toccata-lab", "/toccata-lab/:path*", "/claim", "/claim/:path*"],
};
