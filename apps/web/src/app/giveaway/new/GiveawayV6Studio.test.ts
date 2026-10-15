import { describe, expect, it } from "vitest";

import { chooseGiveawayV6Slot, giveawayV6StudioStep } from "./GiveawayV6Studio";

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

describe("chooseGiveawayV6Slot", () => {
  const slots = [new Date("2026-10-15T12:00:00.000Z"), new Date("2026-10-15T18:00:00.000Z")];

  it("keeps the creator's slot while it is offered", () => {
    expect(chooseGiveawayV6Slot(slots, "2026-10-15T18:00:00.000Z")).toBe(
      "2026-10-15T18:00:00.000Z",
    );
  });

  it("starts with the earliest slot and replaces one that is no longer offered", () => {
    expect(chooseGiveawayV6Slot(slots, "")).toBe("2026-10-15T12:00:00.000Z");
    expect(chooseGiveawayV6Slot(slots, "2026-10-15T06:00:00.000Z")).toBe(
      "2026-10-15T12:00:00.000Z",
    );
    expect(chooseGiveawayV6Slot([], "2026-10-15T12:00:00.000Z")).toBe("");
  });
});
