import { describe, expect, it } from "vitest";

import { extractClientIp, hashClientIp } from "./client-ip";

describe("extractClientIp", () => {
  it("returns the first X-Forwarded-For entry", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.10, 70.41.3.18" });
    expect(extractClientIp(headers)).toBe("203.0.113.10");
  });

  it("falls back to X-Real-IP", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(extractClientIp(headers)).toBe("198.51.100.7");
  });

  it("returns 'unknown' when no forwarding header is present", () => {
    expect(extractClientIp(new Headers())).toBe("unknown");
  });
});

describe("hashClientIp", () => {
  it("produces a stable sha256 hex digest", () => {
    const first = hashClientIp("203.0.113.10");
    const second = hashClientIp("203.0.113.10");
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different digests for different inputs", () => {
    expect(hashClientIp("203.0.113.10")).not.toBe(hashClientIp("203.0.113.11"));
  });
});
