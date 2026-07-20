import { describe, expect, it } from "vitest";

import { sanitizeInternalNextPath } from "./internal-next-path";

describe("sanitizeInternalNextPath", () => {
  it("keeps a local application route", () => {
    expect(sanitizeInternalNextPath("/claim/batch?count=3")).toBe("/claim/batch?count=3");
  });

  it("falls back for external, protocol-relative, and malformed destinations", () => {
    expect(sanitizeInternalNextPath("https://example.com")).toBe("/dashboard");
    expect(sanitizeInternalNextPath("//example.com/path")).toBe("/dashboard");
    expect(sanitizeInternalNextPath("/claim\\batch")).toBe("/dashboard");
    expect(sanitizeInternalNextPath("/claim\nbatch")).toBe("/dashboard");
  });

  it("falls back when no destination was requested", () => {
    expect(sanitizeInternalNextPath(null)).toBe("/dashboard");
    expect(sanitizeInternalNextPath(" ")).toBe("/dashboard");
  });
});
