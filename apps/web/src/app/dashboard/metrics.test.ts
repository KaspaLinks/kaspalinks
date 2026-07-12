import { describe, expect, it } from "vitest";

import {
  buildRecentActivity,
  calculateDashboardAnalyticsRollup,
  calculateDashboardMetrics,
  compactKas,
  compactSompiAsKas,
  dedupeAddressPayments,
  formatSompiAsKas,
  type ActionPaymentBundle,
} from "./metrics";

const NOW = Date.UTC(2026, 4, 17, 12);

function bundle(overrides: Partial<ActionPaymentBundle> = {}): ActionPaymentBundle {
  return {
    action: {
      amountKas: null,
      createdAt: "2026-05-17T00:00:00.000Z",
      disabledAt: null,
      hiddenFromProfile: false,
      id: "internal-1",
      network: "mainnet",
      publicId: "action-1",
      recipientAddress: "kaspa:qexample",
      sharePath: "/u/ada/tips",
      slug: "tips",
      title: "Tips",
      type: "kaspa.tip",
    },
    payments: [],
    ...overrides,
  };
}

describe("dashboard metrics", () => {
  it("formats sompi as KAS without floating point arithmetic", () => {
    expect(formatSompiAsKas(0n)).toBe("0");
    expect(formatSompiAsKas(123_450_000n)).toBe("1.2345");
  });

  it("compacts KAS strings for dashboard display while preserving sub-1 precision", () => {
    expect(compactKas("0")).toBe("0");
    expect(compactKas("1")).toBe("1");
    expect(compactKas("1.30")).toBe("1.3");
    expect(compactKas("2.59869738")).toBe("2.6");
    expect(compactKas("250.48833915")).toBe("250.49");
    expect(compactKas("5.82531021")).toBe("5.83");
    expect(compactKas("1000")).toBe("1K");
    expect(compactKas("1234.56")).toBe("1.23K");
    expect(compactKas("48765.43")).toBe("48.8K");
    expect(compactKas("1234567.89")).toBe("1.23M");
    expect(compactKas("9876543210")).toBe("9.88B");
    // Sub-1 amounts keep enough precision that a small tip doesn't vanish.
    expect(compactKas("0.005")).toBe("0.005");
    expect(compactKas("0.00543210")).toBe("0.0054");
    // Garbage in → echoed back so we never silently lose data.
    expect(compactKas("not-a-number")).toBe("not-a-number");
  });

  it("compacts sompi bigints via the KAS string path", () => {
    expect(compactSompiAsKas(0n)).toBe("0");
    expect(compactSompiAsKas(259_869_738n)).toBe("2.6");
    expect(compactSompiAsKas(25_048_833_915n)).toBe("250.49");
  });

  it("deduplicates identical address outputs across links", () => {
    const payment = {
      amountKas: "1",
      amountSompi: "100000000",
      blockTime: NOW,
      outputIndex: 0,
      transactionId: "abcd",
    };
    const bundles = [bundle({ payments: [payment] }), bundle({ payments: [payment] })];

    expect(dedupeAddressPayments(bundles)).toHaveLength(1);
  });

  // Regression test for the "Support Example showed up against tip
  // receipts" bug: two Actions point at the same recipient wallet
  // (a 2 KAS fixed-amount donation + a variable-amount tip jar),
  // the indexer returns the wallet's full payment history under both
  // bundles, and we want every receipt attached to the correct Action.
  it("attaches fixed-amount payments to the matching fixed Action and lets the variable Action keep the rest", () => {
    const donationAction = {
      ...bundle().action,
      amountKas: "2",
      id: "internal-donation",
      publicId: "donation",
      slug: "support-example",
      title: "Support Example",
      type: "kaspa.donation",
    };
    const tipAction = {
      ...bundle().action,
      amountKas: null,
      id: "internal-tip",
      publicId: "tips",
      slug: "tips",
      title: "Tip Jar",
      type: "kaspa.tip",
    };

    const fixedHit = {
      amountKas: "2",
      amountSompi: "200000000",
      blockTime: NOW - 1000,
      outputIndex: 0,
      transactionId: "tx-donation",
    };
    const smallTip = {
      amountKas: "0.5",
      amountSompi: "50000000",
      blockTime: NOW - 2000,
      outputIndex: 0,
      transactionId: "tx-tip-small",
    };
    const bigTip = {
      amountKas: "5",
      amountSompi: "500000000",
      blockTime: NOW - 3000,
      outputIndex: 0,
      transactionId: "tx-tip-big",
    };

    // Both bundles see the full payment history because the indexer
    // looks up by recipient address, not by Action.
    const sharedHistory = [fixedHit, smallTip, bigTip];
    const result = dedupeAddressPayments([
      bundle({ action: donationAction, payments: sharedHistory }),
      bundle({ action: tipAction, payments: sharedHistory }),
    ]);

    const byTx = new Map(result.map((item) => [item.payment.transactionId, item.action.title]));
    expect(byTx.get("tx-donation")).toBe("Support Example");
    expect(byTx.get("tx-tip-small")).toBe("Tip Jar");
    expect(byTx.get("tx-tip-big")).toBe("Tip Jar");
  });

  // The pathological inverse: a fixed-amount Action whose recipient
  // wallet has receipts that don't match its declared amount (under-
  // or over-payment, or the wallet getting traffic from other places).
  // The final fallback must still surface those payments so the dashboard
  // never silently loses a receipt — even if the label is the only one
  // we have.
  it("falls back to first-bundle-wins for fixed-amount Actions whose receipts don't match", () => {
    const donation = {
      ...bundle().action,
      amountKas: "2",
      title: "Support Example",
    };

    // A receipt that arrived for 1.5 KAS — underpayment, partial tip,
    // or unrelated wallet activity. Without the fallback it would vanish.
    const underpayment = {
      amountKas: "1.5",
      amountSompi: "150000000",
      blockTime: NOW,
      outputIndex: 0,
      transactionId: "tx-mismatch",
    };

    const result = dedupeAddressPayments([bundle({ action: donation, payments: [underpayment] })]);
    expect(result).toHaveLength(1);
    expect(result[0]!.action.title).toBe("Support Example");
  });

  it("calculates totals, active links, and weekly deltas from unique payments", () => {
    const recent = {
      amountKas: "2",
      amountSompi: "200000000",
      blockTime: NOW - 60_000,
      outputIndex: 0,
      transactionId: "recent",
    };
    const old = {
      amountKas: "3",
      amountSompi: "300000000",
      blockTime: NOW - 8 * 24 * 60 * 60 * 1000,
      outputIndex: 0,
      transactionId: "old",
    };

    expect(
      calculateDashboardMetrics(
        [
          bundle({ payments: [recent, old] }),
          bundle({
            action: { ...bundle().action, disabledAt: "2026-05-16T00:00:00.000Z" },
            payments: [recent],
          }),
        ],
        NOW,
      ),
    ).toEqual({
      activeLinks: 1,
      totalLinks: 2,
      totalPayments: 2,
      totalSompi: 500_000_000n,
      weeklyPayments: 1,
      weeklySompi: 200_000_000n,
    });
  });

  it("sorts recent activity newest first and ignores undated receipts", () => {
    const activity = buildRecentActivity(
      [
        bundle({
          payments: [
            {
              amountKas: "1",
              amountSompi: "100000000",
              blockTime: NOW - 1000,
              outputIndex: 0,
              transactionId: "new",
            },
            {
              amountKas: "1",
              amountSompi: "100000000",
              blockTime: null,
              outputIndex: 0,
              transactionId: "pending",
            },
            {
              amountKas: "1",
              amountSompi: "100000000",
              blockTime: NOW - 5000,
              outputIndex: 0,
              transactionId: "old",
            },
          ],
        }),
      ],
      2,
    );

    expect(activity.map((item) => item.payment.transactionId)).toEqual(["new", "old"]);
  });

  it("includes claimed and refunded claimable links in recent activity", () => {
    const activity = buildRecentActivity([bundle()], 6, [
      {
        amountSompi: "1000000000",
        claimedAt: "2026-05-17T11:59:00.000Z",
        claimTxId: "claim-tx",
        feeSompi: "200000",
        id: "claimable-1",
        linkKey: "reward",
        refundedAt: null,
        refundTxId: null,
        title: "Community reward",
      },
      {
        amountSompi: "500000000",
        claimedAt: null,
        claimTxId: null,
        feeSompi: "200000",
        id: "claimable-2",
        linkKey: "expired-reward",
        refundedAt: "2026-05-17T11:58:00.000Z",
        refundTxId: "refund-tx",
        title: "Expired reward",
      },
    ]);

    expect(activity.map((item) => item.action.type)).toEqual(["kaspa.claimable", "kaspa.refund"]);
    expect(activity[0]?.payment).toMatchObject({
      amountKas: "9.998",
      amountSompi: "999800000",
      transactionId: "claim-tx",
    });
    expect(activity[1]?.payment).toMatchObject({
      amountKas: "4.998",
      transactionId: "refund-tx",
    });
  });

  it("rolls up creator link analytics and surfaces the strongest link", () => {
    const tip = bundle({
      action: {
        ...bundle().action,
        publicId: "tip",
        title: "Tip Jar",
      },
    }).action;
    const goal = bundle({
      action: {
        ...bundle().action,
        publicId: "goal",
        title: "Fund the project",
      },
    }).action;

    const rollup = calculateDashboardAnalyticsRollup([tip, goal], {
      goal: analytics({ confirmed: 2, payStarts: 5, views: 80 }),
      tip: analytics({ confirmed: 4, payStarts: 8, views: 50 }),
    });

    expect(rollup).toMatchObject({
      confirmedFromViewRate: 0.0462,
      requestFromViewRate: 0.1,
      totalConfirmed: 6,
      totalPayStarts: 13,
      totalViews: 130,
      windowDays: 90,
    });
    expect(rollup.bestLink?.action.title).toBe("Tip Jar");
  });

  it("excludes disabled links from the analytics rollup", () => {
    const quiet = bundle({
      action: {
        ...bundle().action,
        publicId: "quiet",
        title: "Quiet link",
      },
    }).action;
    const disabled = bundle({
      action: {
        ...bundle().action,
        disabledAt: "2026-05-18T00:00:00.000Z",
        publicId: "disabled",
        title: "Disabled link",
      },
    }).action;

    const rollup = calculateDashboardAnalyticsRollup([quiet, disabled], {
      disabled: analytics({ confirmed: 10, payStarts: 10, views: 10 }),
      quiet: analytics({ confirmed: 0, payStarts: 0, views: 24 }),
    });

    expect(rollup.totalViews).toBe(24);
    expect(rollup.totalPayStarts).toBe(0);
    expect(rollup.totalConfirmed).toBe(0);
    expect(rollup.bestLink?.action.title).toBe("Quiet link");
  });
});

function analytics({
  confirmed,
  payStarts,
  views,
}: {
  confirmed: number;
  payStarts: number;
  views: number;
}) {
  return {
    confirmedPayments: {
      last7d: confirmed,
      total: confirmed,
    },
    conversion: {
      confirmedFromViewRate: views > 0 ? Number((confirmed / views).toFixed(4)) : 0,
      requestFromViewRate: views > 0 ? Number((payStarts / views).toFixed(4)) : 0,
    },
    paymentRequests: {
      last7d: payStarts,
      total: payStarts,
    },
    uniqueVisitors: {
      last7d: views,
      total: views,
    },
    views: {
      last7d: views,
      total: views,
    },
  };
}
