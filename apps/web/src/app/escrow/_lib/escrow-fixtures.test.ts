import { describe, expect, it } from "vitest";

import { computeEscrowAmounts } from "./escrow-amounts";
import {
  createEscrowFixtures,
  ESCROW_FIXTURE_IDS,
  findEscrowFixture,
  isEscrowFixtureId,
} from "./escrow-fixtures";
import { getTimeRemaining } from "./escrow-status";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");

describe("escrow fixtures", () => {
  const fixtures = createEscrowFixtures(NOW);

  it("lists every example deal exactly once", () => {
    expect(fixtures.map((fixture) => fixture.deal.id)).toEqual([...ESCROW_FIXTURE_IDS]);
    expect(new Set(fixtures.map((fixture) => fixture.deal.reference)).size).toBe(fixtures.length);
    expect(isEscrowFixtureId("smartphone-pro")).toBe(true);
    expect(isEscrowFixtureId("not-a-deal")).toBe(false);
    expect(findEscrowFixture("not-a-deal", NOW)).toBeNull();
  });

  it("is deterministic for a given clock", () => {
    expect(createEscrowFixtures(NOW)).toEqual(fixtures);
  });

  it("keeps each status internally consistent", () => {
    for (const { deal } of fixtures) {
      expect(deal.priceSompi).toBeGreaterThan(0n);
      expect(deal.shippingSompi).toBeGreaterThanOrEqual(0n);

      const funded = deal.fundedAt !== null;
      expect(deal.buyerAddressLabel !== null).toBe(funded);
      expect(deal.releaseDeadline !== null).toBe(funded);
      expect(deal.freeze !== null).toBe(deal.status === "frozen" || deal.status === "settled");
      expect(deal.settlement !== null).toBe(deal.status === "settled");
      if (deal.status === "shipped") expect(deal.shipment).not.toBeNull();

      if (deal.settlement) {
        const { totalLockedSompi } = computeEscrowAmounts(deal);
        expect(deal.settlement.buyerSompi + deal.settlement.sellerSompi).toBe(totalLockedSompi);
      }
    }
  });

  it("opens the phone example with the mocked inspection countdown", () => {
    const phone = findEscrowFixture("smartphone-pro", NOW);
    expect(phone?.deal.status).toBe("shipped");
    expect(getTimeRemaining(phone?.deal.releaseDeadline ?? "", NOW).label).toBe("68h 42m");
    expect(computeEscrowAmounts(phone!.deal).buyerLockSompi).toBe(682_500_000_000n);
  });
});
