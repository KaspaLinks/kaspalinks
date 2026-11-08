import { describe, expect, it, vi } from "vitest";

vi.mock("@kaspa-actions/application", () => ({ restoreGiveawayV6Projection: vi.fn() }));
vi.mock("@kaspa-actions/db", () => ({
  GiveawayV6Phase: { OPEN: "OPEN" },
  Network: { MAINNET: "MAINNET" },
  prisma: {},
}));

import {
  type FeaturedGiveawayCandidate,
  FEATURED_GIVEAWAY_MIN_PRIZE_SOMPI,
  pickFeaturedGiveaway,
} from "./featured-giveaway";

const NOW = new Date("2026-11-08T09:00:00.000Z");
const KAS = 100_000_000n;

function candidate(overrides: Partial<FeaturedGiveawayCandidate> = {}): FeaturedGiveawayCandidate {
  return {
    amountSompi: 100n * KAS,
    closesAt: new Date("2026-11-08T12:00:00.000Z"),
    participantCap: 32,
    participantCount: 12,
    publicId: "cmw6m0itx04jz01r32nhaa4g7",
    ...overrides,
  };
}

describe("pickFeaturedGiveaway", () => {
  it("returns only committed numbers of the open giveaway", () => {
    expect(pickFeaturedGiveaway([candidate()], NOW)).toEqual({
      amountKas: "100",
      closesAt: new Date("2026-11-08T12:00:00.000Z"),
      participantCap: 32,
      participantCount: 12,
      publicId: "cmw6m0itx04jz01r32nhaa4g7",
    });
  });

  it("prefers the bigger prize, then the one closing sooner", () => {
    const picked = pickFeaturedGiveaway(
      [
        candidate({ amountSompi: 50n * KAS, publicId: "small" }),
        candidate({
          closesAt: new Date("2026-11-08T18:00:00.000Z"),
          publicId: "big-later",
        }),
        candidate({ publicId: "big-sooner" }),
      ],
      NOW,
    );
    expect(picked?.publicId).toBe("big-sooner");
  });

  it("skips test-sized prizes, full giveaways and ones about to close", () => {
    expect(
      pickFeaturedGiveaway(
        [
          candidate({ amountSompi: FEATURED_GIVEAWAY_MIN_PRIZE_SOMPI - 1n }),
          candidate({ participantCount: 32 }),
          candidate({ closesAt: new Date("2026-11-08T09:10:00.000Z") }),
        ],
        NOW,
      ),
    ).toBeNull();
  });

  it("features a 10 KAS giveaway with a quarter of an hour left", () => {
    expect(
      pickFeaturedGiveaway(
        [
          candidate({
            amountSompi: FEATURED_GIVEAWAY_MIN_PRIZE_SOMPI,
            closesAt: new Date("2026-11-08T09:15:00.000Z"),
          }),
        ],
        NOW,
      )?.amountKas,
    ).toBe("10");
  });
});
