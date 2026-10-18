import { createHash } from "node:crypto";

// Payment links and claimable links created without a KaspaLinks account. The
// browser generates a private manage token and sends only its SHA-256; the token
// itself lives in the private manage link (URL fragment) and in that browser.

type FlagEnv = Readonly<Record<string, string | undefined>>;

export const MANAGE_TOKEN_HEADER = "x-manage-token";
const MANAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** On in development, off in production unless set explicitly. */
export function isAccountFreePaymentLinksEnabled(env: FlagEnv = process.env): boolean {
  const value = env.PAYMENT_LINKS_ANONYMOUS_ENABLED;
  if (value === undefined || value.trim() === "") return env.NODE_ENV !== "production";
  return value.trim().toLowerCase() === "true";
}

/** SHA-256 hex of a well-formed manage token, or null for anything else. */
export function hashManageToken(token: null | string | undefined): null | string {
  const trimmed = token?.trim() ?? "";
  if (!MANAGE_TOKEN_PATTERN.test(trimmed)) return null;
  return createHash("sha256").update(trimmed, "utf8").digest("hex");
}
