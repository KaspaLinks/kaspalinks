import { describe, expect, it } from "vitest";

import { escrowLinkStage } from "./escrow-link-stage";

const base = {
  buyerPublicKey: "buyer",
  chainDaa: "100",
  funding: { state: "awaiting_funding" as const },
  releaseAfter: "200",
  submitted: null,
};

describe("escrowLinkStage", () => {
  it("shows acceptance before the buyer joins", () => {
    expect(escrowLinkStage({ ...base, buyerPublicKey: null })).toBe("accept");
  });

  it("stops offering funding once the committed DAA deadline passes", () => {
    expect(escrowLinkStage({ ...base, chainDaa: "200" })).toBe("funding_expired");
    expect(escrowLinkStage({ ...base, chainDaa: "201" })).toBe("funding_expired");
  });

  it("keeps a funded escrow resolvable after the deadline", () => {
    expect(escrowLinkStage({ ...base, chainDaa: "201", funding: { state: "funded" } })).toBe(
      "resolve",
    );
  });

  it("prioritizes ambiguous output review and a submitted transaction", () => {
    expect(escrowLinkStage({ ...base, funding: { state: "ambiguous" } })).toBe("funding_review");
    expect(escrowLinkStage({ ...base, submitted: { mode: "refund" } })).toBe("submitted");
  });
});
