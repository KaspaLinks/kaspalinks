import { describe, expect, it } from "vitest";

import { PAYMENT_REQUEST_LIFETIME_MS, shouldLazyExpire } from "./payment-request-serializer";

describe("PAYMENT_REQUEST_LIFETIME_MS", () => {
  it("is 15 minutes", () => {
    expect(PAYMENT_REQUEST_LIFETIME_MS).toBe(15 * 60 * 1000);
  });
});

describe("shouldLazyExpire", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("returns true for pending requests past their expiry", () => {
    expect(shouldLazyExpire({ expiresAt: past, status: "PENDING" })).toBe(true);
  });

  it("returns false for already confirmed requests", () => {
    expect(shouldLazyExpire({ expiresAt: past, status: "CONFIRMED" })).toBe(false);
  });

  it("returns false for pending requests still in the window", () => {
    expect(shouldLazyExpire({ expiresAt: future, status: "PENDING" })).toBe(false);
  });
});
