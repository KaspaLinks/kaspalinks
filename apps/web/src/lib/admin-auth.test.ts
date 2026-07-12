import { describe, expect, it } from "vitest";

import {
  isAdminConfigured,
  verifyAdminAuthorizationHeader,
  verifyAdminRequest,
} from "./admin-auth";

const VALID_TOKEN = "kaspa-actions-test-token-123";

describe("isAdminConfigured", () => {
  it("returns true when a non-empty token is provided", () => {
    expect(isAdminConfigured("token")).toBe(true);
  });

  it("returns false for missing or empty tokens", () => {
    expect(isAdminConfigured(undefined)).toBe(false);
    expect(isAdminConfigured("")).toBe(false);
  });
});

describe("verifyAdminAuthorizationHeader", () => {
  it("reports disabled when no token is configured", () => {
    expect(verifyAdminAuthorizationHeader("Bearer abc", undefined)).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("rejects missing or wrongly-prefixed headers", () => {
    expect(verifyAdminAuthorizationHeader(null, VALID_TOKEN)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyAdminAuthorizationHeader("Basic " + VALID_TOKEN, VALID_TOKEN)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyAdminAuthorizationHeader("Bearer ", VALID_TOKEN)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("rejects mismatched tokens of equal length", () => {
    const fake = "x".repeat(VALID_TOKEN.length);
    expect(verifyAdminAuthorizationHeader(`Bearer ${fake}`, VALID_TOKEN)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects tokens with mismatched length safely", () => {
    expect(verifyAdminAuthorizationHeader("Bearer short", VALID_TOKEN)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("accepts the correct token", () => {
    expect(verifyAdminAuthorizationHeader(`Bearer ${VALID_TOKEN}`, VALID_TOKEN)).toEqual({
      ok: true,
    });
  });
});

describe("verifyAdminRequest", () => {
  function makeHeaders(entries: Record<string, string>): Headers {
    const h = new Headers();
    for (const [key, value] of Object.entries(entries)) h.set(key, value);
    return h;
  }

  it("accepts the x-admin-token custom header (lets the browser admin panel coexist with Caddy basic_auth)", () => {
    expect(verifyAdminRequest(makeHeaders({ "x-admin-token": VALID_TOKEN }), VALID_TOKEN)).toEqual({
      ok: true,
    });
  });

  it("rejects an invalid x-admin-token without falling back to authorization", () => {
    expect(
      verifyAdminRequest(
        makeHeaders({
          authorization: `Bearer ${VALID_TOKEN}`,
          "x-admin-token": "x".repeat(VALID_TOKEN.length),
        }),
        VALID_TOKEN,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("falls back to Authorization: Bearer when x-admin-token is absent (SDK / curl use)", () => {
    expect(
      verifyAdminRequest(makeHeaders({ authorization: `Bearer ${VALID_TOKEN}` }), VALID_TOKEN),
    ).toEqual({ ok: true });
  });

  it("reports missing when neither header is present", () => {
    expect(verifyAdminRequest(makeHeaders({}), VALID_TOKEN)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports disabled when no admin token is configured", () => {
    expect(verifyAdminRequest(makeHeaders({ "x-admin-token": "anything" }), undefined)).toEqual({
      ok: false,
      reason: "disabled",
    });
  });
});
