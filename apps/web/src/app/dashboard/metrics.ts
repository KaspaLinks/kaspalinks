const SOMPI_PER_KAS = 100_000_000n;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export type CreatorAction = {
  amountKas: null | string;
  createdAt: string;
  disabledAt: null | string;
  // Internal cuid — only echoed on creator-owned endpoints, never to
  // the public pay page. Used by the dashboard to identify which
  // Action backs Creator.tipActionId.
  id: string;
  // Public profile (/u/<username>) opt-out flag — used to filter the
  // tip-action picker so the creator doesn't accidentally promote a
  // hidden invoice into the prominent quick-tip slot.
  hiddenFromProfile: boolean;
  network: "mainnet" | "testnet";
  publicId: string;
  recipientAddress: string;
  sharePath: string;
  slug: null | string;
  title: string;
  type: string;
};

export type AddressPayment = {
  amountKas: string;
  amountSompi: string;
  blockTime: null | number;
  outputIndex: number;
  transactionId: string;
};

export type ActionPaymentBundle = {
  action: CreatorAction;
  payments: AddressPayment[];
};

export type DashboardMetrics = {
  activeLinks: number;
  totalLinks: number;
  totalPayments: number;
  totalSompi: bigint;
  weeklySompi: bigint;
  weeklyPayments: number;
};

export type CreatorLinkAnalytics = {
  confirmedPayments: {
    last7d: number;
    total: number;
  };
  conversion: {
    confirmedFromViewRate: number;
    requestFromViewRate: number;
  };
  paymentRequests: {
    last7d: number;
    total: number;
  };
  uniqueVisitors: {
    last7d: number;
    total: number;
  };
  views: {
    last7d: number;
    total: number;
  };
};

export type DashboardAnalyticsRollup = {
  bestLink: null | {
    action: CreatorAction;
    analytics: CreatorLinkAnalytics;
  };
  confirmedFromViewRate: number;
  requestFromViewRate: number;
  totalConfirmed: number;
  totalPayStarts: number;
  totalViews: number;
  windowDays: number;
};

export type RecentActivityItem = {
  action: CreatorAction;
  payment: AddressPayment;
};

export function formatSompiAsKas(sompi: bigint): string {
  if (sompi === 0n) return "0";
  const whole = sompi / SOMPI_PER_KAS;
  const decimal = sompi % SOMPI_PER_KAS;
  if (decimal === 0n) return whole.toString();
  const decimalStr = decimal.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${decimalStr}`;
}

/**
 * Compact KAS amount for at-a-glance dashboard display. Keeps full precision
 * in the data layer (tooltips, exports, on-chain views) but in the tiles and
 * recent-activity rows we round so a "2.59869738 KAS" tip reads as "2.6 KAS"
 * — eight decimals of sompi are auditor-relevant, not eyeball-relevant.
 *
 * Heuristic: sub-1 KAS amounts keep up to 4 decimals so tiny tips don't
 * collapse to "0"; values from 1 to 999.99 KAS round to 2 decimals; larger
 * values switch to K/M/B suffixes so cards and compact tables stay readable.
 * Trailing zeros are trimmed so "1.30" displays as "1.3" — the user never
 * has to read padding.
 */
export function compactKas(amountKas: string): string {
  const num = Number(amountKas);
  if (!Number.isFinite(num) || num === 0) return amountKas;

  const absolute = Math.abs(num);
  if (absolute >= 1_000_000_000) return compactScaledKas(num, 1_000_000_000, "B");
  if (absolute >= 1_000_000) return compactScaledKas(num, 1_000_000, "M");
  if (absolute >= 1_000) return compactScaledKas(num, 1_000, "K");

  const maxDecimals = Math.abs(num) < 1 ? 4 : 2;
  const rounded = num.toFixed(maxDecimals);
  if (!rounded.includes(".")) return rounded;
  return rounded.replace(/0+$/, "").replace(/\.$/, "");
}

export function compactSompiAsKas(sompi: bigint): string {
  return compactKas(formatSompiAsKas(sompi));
}

/**
 * Strict KAS-string → sompi-BigInt parser. Used to compare a Creator
 * Action's `amountKas` (e.g. "2", "0.5", "1.50000000") against an
 * AddressPayment's `amountSompi` without going near floating-point
 * arithmetic — see AGENTS.md "Never use Number() on KAS amounts."
 *
 * Returns null on garbage input so callers can fall back to "no fixed
 * amount" semantics (i.e. treat the action as variable-amount).
 */
function parseKasStringToSompi(kas: string): bigint | null {
  const trimmed = kas.trim();
  const match = trimmed.match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!match) return null;
  const whole = BigInt(match[1]!);
  const decimalRaw = match[2] ?? "";
  const decimalPadded = decimalRaw.padEnd(8, "0");
  return whole * SOMPI_PER_KAS + BigInt(decimalPadded);
}

/**
 * Map every (txId, outputIndex) tuple to the Action it most plausibly
 * belongs to.
 *
 * Why this is non-trivial: the indexer-backed payments endpoint queries
 * by recipient wallet address, not by Action. If a creator points two
 * Actions at the same wallet — say a fixed 2 KAS "Support Example"
 * donation and a variable-amount tip jar — both bundles come back with
 * the full payment history on that wallet. A naive "first bundle wins"
 * loop attached every tip to whichever Action sorted first, which is
 * exactly the dashboard bug found during receipt reconciliation: the donation was being
 * labelled onto sub-2-KAS tip receipts.
 *
 * Heuristic, in priority order:
 *
 *   1. Fixed-amount Actions claim only payments whose sompi value
 *      matches their declared amountKas exactly. A 2 KAS donation
 *      attaches itself to a 2 KAS receipt and nothing else.
 *   2. Variable-amount Actions absorb every remaining unclaimed
 *      payment on their wallet. They have no amount to match against,
 *      and they're the natural home for arbitrary tip values.
 *   3. Anything still unclaimed (a fixed-amount Action whose actual
 *      receipts don't match — e.g. an underpayment, an overpayment, or
 *      a wallet that's also being used outside Kaspa Links) falls back
 *      to first-bundle-wins so we never silently drop a receipt.
 *
 * Edge cases this still gets wrong but knowingly: if a creator has
 * two fixed-amount Actions with the same amount on the same wallet
 * (e.g. two "Buy me a coffee — 2 KAS" links), each 2 KAS receipt
 * attaches to whichever sorts first. Surfacing that ambiguity would
 * need PaymentRequest correlation (we have it server-side but don't
 * thread the actionId all the way through to the address-payments
 * indexer route yet). For now: rare enough not to be worth the
 * complexity; can revisit if it ever shows up in real usage.
 */
export function dedupeAddressPayments(bundles: ActionPaymentBundle[]): RecentActivityItem[] {
  const map = new Map<string, RecentActivityItem>();
  const paymentKey = (payment: AddressPayment) => `${payment.transactionId}:${payment.outputIndex}`;

  // Pass 1: fixed-amount actions claim exact-sompi matches first.
  for (const bundle of bundles) {
    if (bundle.action.amountKas === null) continue;
    const expectedSompi = parseKasStringToSompi(bundle.action.amountKas);
    if (expectedSompi === null) continue;
    for (const payment of bundle.payments) {
      const key = paymentKey(payment);
      if (map.has(key)) continue;
      try {
        if (BigInt(payment.amountSompi) === expectedSompi) {
          map.set(key, { action: bundle.action, payment });
        }
      } catch {
        /* unparseable sompi string — skip, the fallback pass will catch it */
      }
    }
  }

  // Pass 2: variable-amount actions sweep up whatever is left on
  // their wallet. They legitimately accept arbitrary amounts, so any
  // unclaimed payment on the same recipient address belongs here.
  for (const bundle of bundles) {
    if (bundle.action.amountKas !== null) continue;
    for (const payment of bundle.payments) {
      const key = paymentKey(payment);
      if (!map.has(key)) {
        map.set(key, { action: bundle.action, payment });
      }
    }
  }

  // Pass 3: fallback — first-bundle-wins for anything still unclaimed
  // (typically a fixed-amount Action whose receipts don't match its
  // declared amount). Better to surface it under *some* label than
  // hide a real on-chain receipt from the dashboard.
  for (const bundle of bundles) {
    for (const payment of bundle.payments) {
      const key = paymentKey(payment);
      if (!map.has(key)) {
        map.set(key, { action: bundle.action, payment });
      }
    }
  }

  return Array.from(map.values());
}

export function calculateDashboardMetrics(
  bundles: ActionPaymentBundle[],
  now = Date.now(),
): DashboardMetrics {
  const uniquePayments = dedupeAddressPayments(bundles);
  let totalSompi = 0n;
  let weeklySompi = 0n;
  let weeklyPayments = 0;
  const weekCutoff = now - SEVEN_DAYS_MS;

  for (const item of uniquePayments) {
    const sompi = safeSompi(item.payment.amountSompi);
    totalSompi += sompi;
    if (item.payment.blockTime !== null && item.payment.blockTime >= weekCutoff) {
      weeklySompi += sompi;
      weeklyPayments += 1;
    }
  }

  return {
    activeLinks: bundles.filter((bundle) => !bundle.action.disabledAt).length,
    totalLinks: bundles.length,
    totalPayments: uniquePayments.length,
    totalSompi,
    weeklyPayments,
    weeklySompi,
  };
}

export function buildRecentActivity(
  bundles: ActionPaymentBundle[],
  limit: number,
): RecentActivityItem[] {
  return dedupeAddressPayments(bundles)
    .filter((item) => item.payment.blockTime !== null)
    .sort((a, b) => (b.payment.blockTime ?? 0) - (a.payment.blockTime ?? 0))
    .slice(0, limit);
}

export function calculateDashboardAnalyticsRollup(
  actions: CreatorAction[],
  analyticsByPublicId: Record<string, CreatorLinkAnalytics>,
  windowDays = 90,
): DashboardAnalyticsRollup {
  const activeActions = actions.filter((action) => !action.disabledAt);
  const rows = activeActions
    .map((action) => {
      const analytics = analyticsByPublicId[action.publicId];
      return analytics ? { action, analytics } : null;
    })
    .filter((row): row is { action: CreatorAction; analytics: CreatorLinkAnalytics } =>
      Boolean(row),
    );

  let totalViews = 0;
  let totalPayStarts = 0;
  let totalConfirmed = 0;
  for (const row of rows) {
    totalViews += row.analytics.views.total;
    totalPayStarts += row.analytics.paymentRequests.total;
    totalConfirmed += row.analytics.confirmedPayments.total;
  }

  const bestLink =
    rows
      .filter((row) => row.analytics.views.total > 0 || row.analytics.confirmedPayments.total > 0)
      .sort((a, b) => {
        const confirmedDelta =
          b.analytics.confirmedPayments.total - a.analytics.confirmedPayments.total;
        if (confirmedDelta !== 0) return confirmedDelta;
        const payStartDelta = b.analytics.paymentRequests.total - a.analytics.paymentRequests.total;
        if (payStartDelta !== 0) return payStartDelta;
        return b.analytics.views.total - a.analytics.views.total;
      })[0] ?? null;

  return {
    bestLink,
    confirmedFromViewRate: ratio(totalConfirmed, totalViews),
    requestFromViewRate: ratio(totalPayStarts, totalViews),
    totalConfirmed,
    totalPayStarts,
    totalViews,
    windowDays,
  };
}

function safeSompi(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function ratio(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number((part / total).toFixed(4));
}

function compactScaledKas(value: number, divisor: number, suffix: "B" | "K" | "M"): string {
  const scaled = value / divisor;
  const maxDecimals = Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0;
  const rounded = scaled.toFixed(maxDecimals);
  const trimmed = rounded.includes(".") ? rounded.replace(/0+$/, "").replace(/\.$/, "") : rounded;
  return `${trimmed}${suffix}`;
}
