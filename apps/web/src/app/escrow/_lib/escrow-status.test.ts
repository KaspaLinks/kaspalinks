import { describe, expect, it } from "vitest";

import { computeEscrowAmounts } from "./escrow-amounts";
import { createEscrowFixtures, findEscrowFixture, type EscrowFixtureId } from "./escrow-fixtures";
import {
  applyEscrowTransition,
  buildEscrowTimeline,
  ESCROW_FREEZE_REASONS,
  ESCROW_STATUS_META,
  ESCROW_STATUSES,
  freezeReasonLabel,
  getEscrowActions,
  getTimeRemaining,
  isDeadlinePassed,
  isEscrowClosed,
} from "./escrow-status";
import type { EscrowDeal } from "./escrow-types";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function deal(id: EscrowFixtureId): EscrowDeal {
  const fixture = findEscrowFixture(id, NOW);
  if (!fixture) throw new Error(`Missing fixture ${id}`);
  return fixture.deal;
}

describe("escrow status labels", () => {
  it("has a label and tone for every status", () => {
    expect(ESCROW_STATUSES).toHaveLength(10);
    for (const status of ESCROW_STATUSES) {
      expect(ESCROW_STATUS_META[status].label.length).toBeGreaterThan(0);
    }
    expect(ESCROW_STATUS_META.frozen).toEqual({ label: "Frozen", tone: "attention" });
    expect(ESCROW_STATUS_META.awaiting_buyer_payment.label).toBe("Awaiting payment");
  });

  it("separates open escrows from closed ones", () => {
    expect(ESCROW_STATUSES.filter(isEscrowClosed).sort()).toEqual([
      "auto_released",
      "cancelled",
      "expired",
      "released",
      "settled",
    ]);
  });

  it("labels every freeze reason", () => {
    expect(ESCROW_FREEZE_REASONS.map((reason) => reason.label)).toEqual([
      "Package not received",
      "Item not as described",
      "Wrong item",
      "Damaged item",
      "Missing parts",
      "Other",
    ]);
    expect(freezeReasonLabel("damaged")).toBe("Damaged item");
  });
});

describe("escrow countdown", () => {
  it("shows hours and minutes for the last three days", () => {
    const deadline = new Date(NOW + 68 * HOUR + 42 * 60 * 1000).toISOString();
    expect(getTimeRemaining(deadline, NOW)).toEqual({ label: "68h 42m", passed: false });
  });

  it("switches to days for longer windows and flags passed deadlines", () => {
    expect(getTimeRemaining(new Date(NOW + 100 * HOUR).toISOString(), NOW).label).toBe("4d 4h");
    expect(getTimeRemaining(new Date(NOW + 30_000).toISOString(), NOW).label).toBe(
      "less than a minute",
    );
    expect(getTimeRemaining(new Date(NOW).toISOString(), NOW)).toEqual({
      label: "Deadline passed",
      passed: true,
    });
    expect(isDeadlinePassed({ releaseDeadline: null }, NOW)).toBe(false);
  });
});

describe("escrow actions", () => {
  it("lets the buyer release or freeze only before the deadline", () => {
    expect(getEscrowActions("shipped", "buyer", false)).toEqual(["release", "freeze"]);
    expect(getEscrowActions("shipped", "buyer", true)).toEqual(["release"]);
  });

  it("lets the seller claim only after the deadline", () => {
    expect(getEscrowActions("funded", "seller", false)).toEqual(["mark_shipped", "refund_buyer"]);
    expect(getEscrowActions("shipped", "seller", true)).toEqual([
      "claim_after_deadline",
      "refund_buyer",
    ]);
  });

  it("only allows a joint settlement while frozen and nothing once closed", () => {
    expect(getEscrowActions("frozen", "buyer", true)).toEqual(["settle"]);
    expect(getEscrowActions("frozen", "seller", false)).toEqual(["settle"]);
    for (const status of ESCROW_STATUSES.filter(isEscrowClosed)) {
      expect(getEscrowActions(status, "buyer", false)).toEqual([]);
      expect(getEscrowActions(status, "seller", true)).toEqual([]);
    }
  });

  it("keeps the buyer from paying before the seller deposit is locked", () => {
    expect(getEscrowActions("awaiting_seller_deposit", "buyer", false)).toEqual([]);
    expect(getEscrowActions("awaiting_buyer_payment", "buyer", false)).toEqual(["pay"]);
  });
});

describe("escrow transitions", () => {
  it("walks a deal from created link to release", () => {
    let current = deal("community-hoodie");
    current = applyEscrowTransition(current, "seller", { type: "lock_deposit" }, NOW);
    expect(current.status).toBe("awaiting_buyer_payment");

    current = applyEscrowTransition(
      current,
      "buyer",
      { buyerAddressLabel: "kaspa:qtest…0000", type: "pay" },
      NOW,
    );
    expect(current.status).toBe("funded");
    expect(current.releaseDeadline).toBe(new Date(NOW + 7 * 24 * HOUR).toISOString());

    current = applyEscrowTransition(
      current,
      "seller",
      { carrier: "DHL", trackingNumber: "123", type: "mark_shipped" },
      NOW + HOUR,
    );
    expect(current.status).toBe("shipped");
    expect(current.shipment?.carrier).toBe("DHL");

    current = applyEscrowTransition(current, "buyer", { type: "release" }, NOW + 2 * HOUR);
    expect(current.status).toBe("released");
    expect(current.closedAt).not.toBeNull();
  });

  it("rejects paths that are not open to that party", () => {
    const shipped = deal("smartphone-pro");
    expect(() => applyEscrowTransition(shipped, "seller", { type: "release" }, NOW)).toThrow();
    expect(() =>
      applyEscrowTransition(shipped, "seller", { type: "claim_after_deadline" }, NOW),
    ).toThrow();

    const afterDeadline = NOW + 69 * HOUR;
    expect(
      applyEscrowTransition(shipped, "seller", { type: "claim_after_deadline" }, afterDeadline)
        .status,
    ).toBe("auto_released");
    expect(() =>
      applyEscrowTransition(
        shipped,
        "buyer",
        { note: "", reason: "damaged", type: "freeze" },
        afterDeadline,
      ),
    ).toThrow();
  });

  it("settles a frozen escrow only when the split matches the locked total", () => {
    const frozen = deal("smartwatch-x");
    const { totalLockedSompi } = computeEscrowAmounts(frozen);

    expect(() =>
      applyEscrowTransition(
        frozen,
        "buyer",
        { buyerSompi: 1n, sellerSompi: totalLockedSompi, type: "settle" },
        NOW,
      ),
    ).toThrow();

    const settled = applyEscrowTransition(
      frozen,
      "buyer",
      { buyerSompi: 1n, sellerSompi: totalLockedSompi - 1n, type: "settle" },
      NOW,
    );
    expect(settled.status).toBe("settled");
    expect(settled.settlement?.buyerSompi).toBe(1n);
  });
});

describe("escrow timeline", () => {
  const states = (id: EscrowFixtureId) =>
    buildEscrowTimeline(deal(id)).map((step) => `${step.id}:${step.state}`);

  it("marks the step each example deal is waiting on", () => {
    expect(states("community-hoodie")).toEqual([
      "deposit:current",
      "payment:upcoming",
      "shipment:upcoming",
      "outcome:upcoming",
    ]);
    expect(states("wireless-headphones")).toEqual([
      "deposit:done",
      "payment:done",
      "shipment:current",
      "outcome:upcoming",
    ]);
    expect(states("smartphone-pro")).toEqual([
      "deposit:done",
      "payment:done",
      "shipment:done",
      "outcome:current",
    ]);
    expect(states("smartwatch-x")).toEqual([
      "deposit:done",
      "payment:done",
      "shipment:done",
      "outcome:attention",
    ]);
  });

  it("skips steps that never happened", () => {
    expect(states("mechanical-keyboard")).toEqual([
      "deposit:done",
      "payment:done",
      "shipment:skipped",
      "outcome:done",
    ]);
    expect(states("film-camera")).toEqual([
      "deposit:done",
      "payment:skipped",
      "shipment:skipped",
      "outcome:done",
    ]);
    expect(buildEscrowTimeline(deal("mechanical-keyboard"))[0]?.label).toBe("Link activated");
  });

  it("covers every status across the example deals", () => {
    const statuses = new Set(createEscrowFixtures(NOW).map((fixture) => fixture.deal.status));
    expect([...statuses].sort()).toEqual([...ESCROW_STATUSES].sort());
  });
});
