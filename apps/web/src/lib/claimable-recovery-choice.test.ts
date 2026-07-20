import { describe, expect, it } from "vitest";

import { isSingleClaimableFundingUnlocked } from "./claimable-recovery-choice";

describe("single claimable recovery choice", () => {
  it("keeps funding locked before the creator chooses a recovery path", () => {
    expect(isSingleClaimableFundingUnlocked(null, null)).toBe(false);
    expect(isSingleClaimableFundingUnlocked(" ", " ")).toBe(false);
  });

  it("unlocks funding after the recovery bundle is downloaded", () => {
    expect(isSingleClaimableFundingUnlocked("2026-07-20T18:00:00.000Z", null)).toBe(true);
  });

  it("unlocks funding after the creator explicitly accepts the missing-backup risk", () => {
    expect(isSingleClaimableFundingUnlocked(null, "2026-07-20T18:00:00.000Z")).toBe(true);
  });
});
