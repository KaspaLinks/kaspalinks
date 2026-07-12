import { describe, expect, it } from "vitest";

import { generateFakeTxId, isMockConfirmEnabled } from "./mock-confirm";

describe("isMockConfirmEnabled", () => {
  it("defaults to false when the env var is unset", () => {
    expect(isMockConfirmEnabled(undefined)).toBe(false);
  });

  it("returns true only for the literal string 'true'", () => {
    expect(isMockConfirmEnabled("true")).toBe(true);
    expect(isMockConfirmEnabled("True")).toBe(false);
    expect(isMockConfirmEnabled("1")).toBe(false);
    expect(isMockConfirmEnabled("yes")).toBe(false);
  });
});

describe("generateFakeTxId", () => {
  it("returns a prefixed hex identifier", () => {
    const id = generateFakeTxId();
    expect(id.startsWith("mock-")).toBe(true);
    expect(id.slice("mock-".length)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates a different value every call", () => {
    expect(generateFakeTxId()).not.toBe(generateFakeTxId());
  });
});
