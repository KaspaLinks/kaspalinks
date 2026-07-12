import { createHash, timingSafeEqual } from "node:crypto";

export type AdminAuthFailure = {
  ok: false;
  reason: "disabled" | "invalid" | "missing";
};

export type AdminAuthSuccess = {
  ok: true;
};

export type AdminAuthResult = AdminAuthFailure | AdminAuthSuccess;

function digest(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

export function isAdminConfigured(token = process.env.ADMIN_ACCESS_TOKEN): boolean {
  return typeof token === "string" && token.length > 0;
}

export function verifyAdminAuthorizationHeader(
  headerValue: null | string,
  expected = process.env.ADMIN_ACCESS_TOKEN,
): AdminAuthResult {
  if (!isAdminConfigured(expected)) {
    return { ok: false, reason: "disabled" };
  }

  if (!headerValue) {
    return { ok: false, reason: "missing" };
  }

  if (!headerValue.startsWith("Bearer ")) {
    return { ok: false, reason: "missing" };
  }

  const presented = headerValue.slice("Bearer ".length).trim();
  if (presented.length === 0) {
    return { ok: false, reason: "missing" };
  }

  const presentedDigest = digest(presented);
  const expectedDigest = digest(expected as string);

  if (presentedDigest.length !== expectedDigest.length) {
    return { ok: false, reason: "invalid" };
  }

  return timingSafeEqual(presentedDigest, expectedDigest)
    ? { ok: true }
    : { ok: false, reason: "invalid" };
}

/**
 * Verify the admin credential from a request's headers. Checks the custom
 * `x-admin-token` header first (used by the browser admin panel — it
 * doesn't conflict with the closed-beta `Authorization: Basic ...` header
 * that Caddy attaches), then falls back to `Authorization: Bearer ...`
 * (for CLI / curl / non-browser callers where no BasicAuth is in play).
 */
export function verifyAdminRequest(
  headers: Headers,
  expected = process.env.ADMIN_ACCESS_TOKEN,
): AdminAuthResult {
  if (!isAdminConfigured(expected)) {
    return { ok: false, reason: "disabled" };
  }

  const customHeader = headers.get("x-admin-token")?.trim();
  if (customHeader && customHeader.length > 0) {
    const presentedDigest = digest(customHeader);
    const expectedDigest = digest(expected as string);
    if (
      presentedDigest.length === expectedDigest.length &&
      timingSafeEqual(presentedDigest, expectedDigest)
    ) {
      return { ok: true };
    }
    return { ok: false, reason: "invalid" };
  }

  return verifyAdminAuthorizationHeader(headers.get("authorization"), expected);
}
