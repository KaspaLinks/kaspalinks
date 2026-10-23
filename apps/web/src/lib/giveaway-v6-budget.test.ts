import { describe, expect, it } from "vitest";

import { buildGiveawayV6Budget, giveawayV6EmptyNetworkFeesSompi } from "./giveaway-v6-budget";

describe("giveawayV6EmptyNetworkFeesSompi", () => {
  it("matches an empty 32-place Mainnet giveaway: 5.15 KAS funded, 4.67 KAS returned", () => {
    const budget = buildGiveawayV6Budget(100_000_000n, 32);

    expect(budget.expectedFundingSompi).toBe(515_000_000n);
    expect(giveawayV6EmptyNetworkFeesSompi(budget.shardCount)).toBe(48_000_000n);
    expect(budget.expectedFundingSompi - giveawayV6EmptyNetworkFeesSompi(budget.shardCount)).toBe(
      467_000_000n,
    );
  });

  it("costs less with fewer shards", () => {
    expect(giveawayV6EmptyNetworkFeesSompi(1)).toBe(30_000_000n);
    expect(giveawayV6EmptyNetworkFeesSompi(2)).toBe(36_000_000n);
  });
});
