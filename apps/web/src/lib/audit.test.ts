import { describe, expect, it } from "vitest";

import { sanitizeAuditMetadata } from "./audit";

describe("sanitizeAuditMetadata", () => {
  it("returns null for empty or missing input", () => {
    expect(sanitizeAuditMetadata(undefined)).toBeNull();
    expect(sanitizeAuditMetadata({})).toBeNull();
  });

  it("strips forbidden keys", () => {
    const cleaned = sanitizeAuditMetadata({
      adminToken: "secret",
      authorization: "Bearer xyz",
      publicId: "abc",
      seedPhrase: "secret",
    });

    expect(cleaned).toEqual({ publicId: "abc" });
  });

  it("returns null when every key is forbidden", () => {
    expect(sanitizeAuditMetadata({ adminToken: "x", secret: "y" })).toBeNull();
  });
});
