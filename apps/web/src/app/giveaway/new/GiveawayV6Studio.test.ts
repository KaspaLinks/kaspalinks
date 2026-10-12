import { describe, expect, it } from "vitest";

import { giveawayV6StudioStep } from "./GiveawayV6Studio";

describe("giveawayV6StudioStep", () => {
  it("keeps an unfunded setup on the funding step", () => {
    expect(
      giveawayV6StudioStep({
        funding: { status: "AWAITING_FUNDING" },
        phase: "AWAITING_ACTIVATION",
        shareReady: false,
      }),
    ).toBe(2);
  });

  it("separates relay submission from confirmed share readiness", () => {
    expect(
      giveawayV6StudioStep({
        funding: { status: "BOUND" },
        phase: "AWAITING_ACTIVATION",
        shareReady: false,
      }),
    ).toBe(3);
    expect(
      giveawayV6StudioStep({
        funding: { status: "BOUND" },
        phase: "OPEN",
        shareReady: true,
      }),
    ).toBe(4);
  });
});
