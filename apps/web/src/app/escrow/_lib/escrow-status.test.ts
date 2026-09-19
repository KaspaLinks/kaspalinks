import { describe, expect, it } from "vitest";
import { computeEscrowAmounts } from "./escrow-amounts";
import { findEscrowFixture, type EscrowFixtureId } from "./escrow-fixtures";
import {
  applyEscrowTransition,
  buildEscrowTimeline,
  ESCROW_STATUS_META,
  ESCROW_STATUSES,
  getEscrowActions,
  getTimeRemaining,
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

describe("escrow V1 status model", () => {
  it("uses only canonical covenant and lifecycle states", () => {
    expect(ESCROW_STATUSES).toHaveLength(11);
    expect(ESCROW_STATUS_META.awaiting_funding.label).toBe("Awaiting funding");
    expect(ESCROW_STATUSES.filter(isEscrowClosed).sort()).toEqual([
      "cancelled_unfunded",
      "claimed",
      "refunded",
      "released",
      "settled",
    ]);
  });

  it("exposes role-specific actions", () => {
    expect(getEscrowActions("awaiting_funding", "buyer", false)).toEqual(["pay"]);
    expect(getEscrowActions("active", "buyer", true, true)).toEqual(["release", "freeze"]);
    expect(getEscrowActions("active", "seller", false, false)).toEqual([
      "mark_shipped",
      "refund_buyer",
    ]);
    expect(getEscrowActions("active", "seller", true, true)).toEqual([
      "claim_after_deadline",
      "refund_buyer",
    ]);
    expect(getEscrowActions("frozen", "seller", false)).toEqual(["refund_buyer", "settle"]);
    expect(getEscrowActions("unknown_spend", "buyer", false)).toEqual([]);
  });

  it("walks funding, shipment and release without changing the on-chain active state", () => {
    let current = deal("community-hoodie");
    current = applyEscrowTransition(
      current,
      "buyer",
      { buyerAddressLabel: "kaspa:qtest…0000", type: "pay" },
      NOW,
    );
    expect(current.status).toBe("active");
    current = applyEscrowTransition(
      current,
      "seller",
      { carrier: "DHL", trackingNumber: "123", type: "mark_shipped" },
      NOW + HOUR,
    );
    expect(current.status).toBe("active");
    expect(current.shipment?.carrier).toBe("DHL");
    current = applyEscrowTransition(current, "buyer", { type: "release" }, NOW + 2 * HOUR);
    expect(current.status).toBe("released");
  });

  it("records claim and refund as distinct terminal outcomes", () => {
    const active = deal("smartphone-pro");
    expect(() =>
      applyEscrowTransition(active, "seller", { type: "claim_after_deadline" }, NOW),
    ).toThrow();
    expect(
      applyEscrowTransition(active, "seller", { type: "claim_after_deadline" }, NOW + 69 * HOUR)
        .status,
    ).toBe("claimed");
    expect(applyEscrowTransition(active, "seller", { type: "refund_buyer" }, NOW).status).toBe(
      "refunded",
    );
  });

  it("settles a frozen escrow only for the exact locked total", () => {
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
    expect(
      applyEscrowTransition(
        frozen,
        "buyer",
        { buyerSompi: 1n, sellerSompi: totalLockedSompi - 1n, type: "settle" },
        NOW,
      ).status,
    ).toBe("settled");
  });

  it("keeps shipment as metadata rather than a covenant state", () => {
    expect(
      buildEscrowTimeline(deal("smartphone-pro")).map((step) => `${step.id}:${step.state}`),
    ).toEqual(["link:done", "payment:done", "shipment:done", "outcome:current"]);
  });
});

describe("escrow countdown", () => {
  it("shows remaining time and the deadline", () => {
    expect(getTimeRemaining(new Date(NOW + 68 * HOUR + 42 * 60_000).toISOString(), NOW)).toEqual({
      label: "68h 42m",
      passed: false,
    });
    expect(getTimeRemaining(new Date(NOW).toISOString(), NOW)).toEqual({
      label: "Deadline passed",
      passed: true,
    });
  });
});
