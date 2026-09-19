import { parseKaspaAmountToSompi } from "@kaspa-actions/kaspa/amount";

import type { EscrowDeal, EscrowRole } from "./escrow-types";

// Example deals for the Phase 1 prototype. Dates are built relative to `nowMs`
// so countdowns stay meaningful whenever the prototype is opened, and tests can
// pass a fixed clock. Nothing here exists on chain.

export type EscrowFixture = {
  deal: EscrowDeal;
  /** The perspective the example opens in; the prototype controls can switch it. */
  defaultRole: EscrowRole;
};

export const ESCROW_FIXTURE_IDS = [
  "smartphone-pro",
  "laptop-16",
  "wireless-headphones",
  "smartwatch-x",
  "community-hoodie",
  "mirrorless-camera",
  "handheld-console",
  "prime-lens",
  "mechanical-keyboard",
  "film-camera",
] as const;

export type EscrowFixtureId = (typeof ESCROW_FIXTURE_IDS)[number];

export function isEscrowFixtureId(id: string): id is EscrowFixtureId {
  return (ESCROW_FIXTURE_IDS as readonly string[]).includes(id);
}

export const ESCROW_EXAMPLE_SELLER = "nordlicht";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function kas(amount: string): bigint {
  return parseKaspaAmountToSompi(amount);
}

export function createEscrowFixtures(nowMs: number): EscrowFixture[] {
  const iso = (ms: number) => new Date(ms).toISOString();

  // Opens with the inspection countdown from the original mockup: 68h 42m left.
  const phoneDeadlineMs = nowMs + 68 * HOUR_MS + 42 * MINUTE_MS;
  const phoneFundedMs = phoneDeadlineMs - 14 * DAY_MS;

  const headphonesFundedMs = nowMs - 9 * HOUR_MS;
  const watchFundedMs = nowMs - 8 * DAY_MS;
  const consoleFundedMs = nowMs - 6 * DAY_MS;
  const cameraFundedMs = nowMs - 12 * DAY_MS;
  const lensFundedMs = nowMs - 8 * DAY_MS;
  const keyboardFundedMs = nowMs - 5 * DAY_MS;

  const deals: Array<{ deal: Omit<EscrowDeal, "sellerUsername">; defaultRole: EscrowRole }> = [
    {
      deal: {
        buyerAddressLabel: "kaspa:qr7d…4k9m",
        closedAt: null,
        condition: "used",
        createdAt: iso(phoneFundedMs - 5 * HOUR_MS),
        description:
          "Latest model, 256 GB, very good condition. Comes with original box and charger. No scratches.",
        freeze: null,
        fundedAt: iso(phoneFundedMs),
        id: "smartphone-pro",
        priceSompi: kas("4500"),
        reference: "ESC-28471",
        releaseDeadline: iso(phoneDeadlineMs),
        releaseWindowDays: 14,
        settlement: null,
        shipment: {
          carrier: "DHL",
          shippedAt: iso(phoneFundedMs + 20 * HOUR_MS),
          trackingNumber: "00340434161234567890",
        },
        shippingSompi: kas("50"),
        status: "active",
        title: "Smartphone Pro 256 GB",
      },
      defaultRole: "buyer",
    },
    {
      deal: {
        buyerAddressLabel: null,
        closedAt: null,
        condition: "like_new",
        createdAt: iso(nowMs - 3 * HOUR_MS),
        description:
          "16-inch display, 1 TB SSD, 32 GB RAM. Bought last year, battery health 96 %. Sleeve included.",
        freeze: null,
        fundedAt: null,
        id: "laptop-16",
        priceSompi: kas("12800"),
        reference: "ESC-28502",
        releaseDeadline: null,
        releaseWindowDays: 14,
        settlement: null,
        shipment: null,
        shippingSompi: kas("120"),
        status: "awaiting_funding",
        title: 'Laptop 16" 1TB',
      },
      defaultRole: "buyer",
    },
    {
      deal: {
        buyerAddressLabel: "kaspa:qz3f…m2xa",
        closedAt: null,
        condition: "used",
        createdAt: iso(headphonesFundedMs - 2 * HOUR_MS),
        description: "Noise cancelling, around 30 hours battery. Ear pads replaced in spring.",
        freeze: null,
        fundedAt: iso(headphonesFundedMs),
        id: "wireless-headphones",
        priceSompi: kas("1250"),
        reference: "ESC-28436",
        releaseDeadline: iso(headphonesFundedMs + 7 * DAY_MS),
        releaseWindowDays: 7,
        settlement: null,
        shipment: null,
        shippingSompi: kas("30"),
        status: "active",
        title: "Wireless Headphones",
      },
      defaultRole: "seller",
    },
    {
      deal: {
        buyerAddressLabel: "kaspa:qp9x…7hte",
        closedAt: null,
        condition: "like_new",
        createdAt: iso(watchFundedMs - 6 * HOUR_MS),
        description: "Series X, 45 mm, with two straps. Always worn with a screen protector.",
        freeze: {
          frozenAt: iso(nowMs - 2 * DAY_MS),
          note: "The screen has a visible scratch that was not mentioned in the description.",
          reason: "not_as_described",
        },
        fundedAt: iso(watchFundedMs),
        id: "smartwatch-x",
        priceSompi: kas("2900"),
        reference: "ESC-28390",
        releaseDeadline: iso(watchFundedMs + 14 * DAY_MS),
        releaseWindowDays: 14,
        settlement: null,
        shipment: {
          carrier: "DPD",
          shippedAt: iso(watchFundedMs + DAY_MS),
          trackingNumber: "01905012345678",
        },
        shippingSompi: kas("40"),
        status: "frozen",
        title: "Smartwatch Series X",
      },
      defaultRole: "buyer",
    },
    {
      deal: {
        buyerAddressLabel: null,
        closedAt: null,
        condition: "new",
        createdAt: iso(nowMs - 10 * MINUTE_MS),
        description: "Unworn community hoodie, size L. Ordered two by mistake.",
        freeze: null,
        fundedAt: null,
        id: "community-hoodie",
        priceSompi: kas("450"),
        reference: "ESC-28533",
        releaseDeadline: null,
        releaseWindowDays: 7,
        settlement: null,
        shipment: null,
        shippingSompi: kas("20"),
        status: "awaiting_funding",
        title: "Kaspa Community Hoodie (L)",
      },
      defaultRole: "seller",
    },
    {
      deal: {
        buyerAddressLabel: "kaspa:qq4v…9dcw",
        closedAt: iso(nowMs - 3 * DAY_MS),
        condition: "used",
        createdAt: iso(cameraFundedMs - DAY_MS),
        description: "Around 12,000 shutter count. Body only, two batteries and charger.",
        freeze: {
          frozenAt: iso(cameraFundedMs + 4 * DAY_MS),
          note: "Second battery does not hold a charge.",
          reason: "missing_parts",
        },
        fundedAt: iso(cameraFundedMs),
        id: "mirrorless-camera",
        priceSompi: kas("9400"),
        reference: "ESC-28255",
        releaseDeadline: iso(cameraFundedMs + 30 * DAY_MS),
        releaseWindowDays: 30,
        settlement: {
          buyerSompi: kas("3370"),
          sellerSompi: kas("6110"),
          settledAt: iso(nowMs - 3 * DAY_MS),
        },
        shipment: {
          carrier: "Hermes",
          shippedAt: iso(cameraFundedMs + DAY_MS),
          trackingNumber: "H1003456789012345678",
        },
        shippingSompi: kas("80"),
        status: "settled",
        title: "Mirrorless Camera Body",
      },
      defaultRole: "buyer",
    },
    {
      deal: {
        buyerAddressLabel: "kaspa:qrm2…p0s8",
        closedAt: iso(nowMs - 2 * DAY_MS),
        condition: "used",
        createdAt: iso(consoleFundedMs - 3 * HOUR_MS),
        description: "Handheld console with three game cartridges and a carrying case.",
        freeze: null,
        fundedAt: iso(consoleFundedMs),
        id: "handheld-console",
        priceSompi: kas("3600"),
        reference: "ESC-28311",
        releaseDeadline: iso(consoleFundedMs + 14 * DAY_MS),
        releaseWindowDays: 14,
        settlement: null,
        shipment: {
          carrier: "GLS",
          shippedAt: iso(consoleFundedMs + DAY_MS),
          trackingNumber: "ZK4R7T2M",
        },
        shippingSompi: kas("60"),
        status: "released",
        title: "Handheld Console + 3 Games",
      },
      defaultRole: "seller",
    },
    {
      deal: {
        buyerAddressLabel: "kaspa:qyh6…3fq2",
        closedAt: iso(nowMs - DAY_MS),
        condition: "like_new",
        createdAt: iso(lensFundedMs - 5 * HOUR_MS),
        description: "50mm f/1.8 prime lens with both caps and the original hood.",
        freeze: null,
        fundedAt: iso(lensFundedMs),
        id: "prime-lens",
        priceSompi: kas("1900"),
        reference: "ESC-28120",
        releaseDeadline: iso(lensFundedMs + 7 * DAY_MS),
        releaseWindowDays: 7,
        settlement: null,
        shipment: {
          carrier: "DHL",
          shippedAt: iso(lensFundedMs + 16 * HOUR_MS),
          trackingNumber: "00340434169876543210",
        },
        shippingSompi: kas("35"),
        status: "claimed",
        title: "50mm Prime Lens",
      },
      defaultRole: "seller",
    },
    {
      deal: {
        buyerAddressLabel: "kaspa:qz8k…t6vn",
        closedAt: iso(nowMs - 4 * DAY_MS),
        condition: "used",
        createdAt: iso(keyboardFundedMs - HOUR_MS),
        description: "Tenkeyless layout with tactile switches. Some keycaps show shine.",
        freeze: null,
        fundedAt: iso(keyboardFundedMs),
        id: "mechanical-keyboard",
        priceSompi: kas("700"),
        reference: "ESC-28198",
        releaseDeadline: iso(keyboardFundedMs + 7 * DAY_MS),
        releaseWindowDays: 7,
        settlement: null,
        shipment: null,
        shippingSompi: kas("25"),
        status: "refunded",
        title: "Mechanical Keyboard",
      },
      defaultRole: "seller",
    },
    {
      deal: {
        buyerAddressLabel: null,
        closedAt: iso(nowMs - 13 * DAY_MS),
        condition: "for_parts",
        createdAt: iso(nowMs - 20 * DAY_MS),
        description: "Shutter sticks at slow speeds. Sold for parts or repair.",
        freeze: null,
        fundedAt: null,
        id: "film-camera",
        priceSompi: kas("380"),
        reference: "ESC-28077",
        releaseDeadline: null,
        releaseWindowDays: 7,
        settlement: null,
        shipment: null,
        shippingSompi: kas("25"),
        status: "cancelled_unfunded",
        title: "Vintage Film Camera",
      },
      defaultRole: "seller",
    },
  ];

  return deals.map(({ deal, defaultRole }) => ({
    deal: { ...deal, sellerUsername: ESCROW_EXAMPLE_SELLER },
    defaultRole,
  }));
}

export function findEscrowFixture(id: string, nowMs: number): EscrowFixture | null {
  return createEscrowFixtures(nowMs).find((fixture) => fixture.deal.id === id) ?? null;
}
