import { beforeEach, describe, expect, it } from "vitest";

import { consumeRateLimit, resetRateLimits, retryAfterSeconds } from "./rate-limit";

beforeEach(() => {
  resetRateLimits();
});

describe("consumeRateLimit", () => {
  it("allows requests up to the configured limit", () => {
    const options = { bucket: "test", identifier: "ip", limit: 3, windowMs: 60_000, now: 1_000 };

    expect(consumeRateLimit(options).allowed).toBe(true);
    expect(consumeRateLimit({ ...options, now: 1_100 }).allowed).toBe(true);
    expect(consumeRateLimit({ ...options, now: 1_200 }).allowed).toBe(true);
    expect(consumeRateLimit({ ...options, now: 1_300 }).allowed).toBe(false);
  });

  it("resets after the window passes", () => {
    const base = { bucket: "test", identifier: "ip", limit: 1, windowMs: 1_000 };

    expect(consumeRateLimit({ ...base, now: 0 }).allowed).toBe(true);
    expect(consumeRateLimit({ ...base, now: 500 }).allowed).toBe(false);
    expect(consumeRateLimit({ ...base, now: 1_500 }).allowed).toBe(true);
  });

  it("tracks identifiers independently", () => {
    const base = { bucket: "test", limit: 1, windowMs: 60_000, now: 0 };
    expect(consumeRateLimit({ ...base, identifier: "a" }).allowed).toBe(true);
    expect(consumeRateLimit({ ...base, identifier: "b" }).allowed).toBe(true);
    expect(consumeRateLimit({ ...base, identifier: "a", now: 10 }).allowed).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  it("returns at least 1", () => {
    expect(retryAfterSeconds(0, 1_000)).toBe(1);
  });

  it("rounds up partial seconds", () => {
    expect(retryAfterSeconds(2_500, 1_000)).toBe(2);
  });
});
