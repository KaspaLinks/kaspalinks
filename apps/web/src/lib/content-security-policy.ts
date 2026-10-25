// The Content-Security-Policy for HTML pages (see proxy.ts).

/**
 * Pages that run the Kaspa WASM signer in the browser. Its wasm-bindgen glue
 * keeps one `new Function` call, so these pages still need 'unsafe-eval';
 * everywhere else 'wasm-unsafe-eval' is enough.
 */
const WASM_SIGNER_PREFIXES = ["/claim", "/toccata-lab", "/escrow", "/escrows", "/mediated-escrows"];

/** Pages the Telegram Mini App embeds (Telegram Web shows them in an iframe). */
const TELEGRAM_EMBED_PREFIXES = [
  "/telegram",
  "/toccata-lab/giveaway",
  "/sign-in",
  "/create-profile",
];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function buildContentSecurityPolicy(input: {
  development: boolean;
  nonce: string;
  pathname: string;
}): string {
  const evalSource =
    input.development || matchesPrefix(input.pathname, WASM_SIGNER_PREFIXES)
      ? "'unsafe-eval'"
      : "'wasm-unsafe-eval'";
  const frameAncestors = matchesPrefix(input.pathname, TELEGRAM_EMBED_PREFIXES)
    ? "https://web.telegram.org"
    : "'none'";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' ${evalSource} https://challenges.cloudflare.com https://telegram.org`,
    // Inline style attributes are used throughout the app.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
