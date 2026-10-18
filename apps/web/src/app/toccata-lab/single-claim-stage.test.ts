import { describe, expect, it } from "vitest";

import { singleClaimStage } from "./single-claim-stage";

const autoReturn = { autoReturn: true, recoveryReady: false, windowEnded: false };

describe("singleClaimStage", () => {
  it("walks an auto-return link from the form to sharing without a recovery step", () => {
    expect(singleClaimStage({ ...autoReturn, status: null })).toBe("form");
    expect(singleClaimStage({ ...autoReturn, status: "awaiting_funding" })).toBe("fund");
    expect(singleClaimStage({ ...autoReturn, status: "funded" })).toBe("share");
    expect(singleClaimStage({ ...autoReturn, status: "shared" })).toBe("share");
  });

  it("asks a classic link for its recovery file before the payment details", () => {
    const classic = { autoReturn: false, windowEnded: false };
    expect(singleClaimStage({ ...classic, recoveryReady: false, status: "awaiting_funding" })).toBe(
      "save",
    );
    expect(singleClaimStage({ ...classic, recoveryReady: true, status: "awaiting_funding" })).toBe(
      "fund",
    );
    expect(singleClaimStage({ ...classic, recoveryReady: true, status: "funded" })).toBe("share");
  });

  it("returns or refunds a paid link once its window has ended", () => {
    expect(singleClaimStage({ ...autoReturn, status: "funded", windowEnded: true })).toBe(
      "returning",
    );
    expect(
      singleClaimStage({
        autoReturn: false,
        recoveryReady: true,
        status: "refundable",
        windowEnded: false,
      }),
    ).toBe("refund");
  });

  it("is done once the output is spent, whatever the clock says", () => {
    for (const status of ["claimed", "refunded", "spent_unknown"]) {
      expect(singleClaimStage({ ...autoReturn, status, windowEnded: true })).toBe("done");
    }
  });

  it("lets an unpaid link that ran out simply start over", () => {
    expect(singleClaimStage({ ...autoReturn, status: "awaiting_funding", windowEnded: true })).toBe(
      "expired_unfunded",
    );
  });
});
