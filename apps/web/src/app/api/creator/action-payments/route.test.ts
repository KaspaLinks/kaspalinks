import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetKaspaIndexer, mockPrisma, mockRequireCreator } = vi.hoisted(() => ({
  mockGetKaspaIndexer: vi.fn(),
  mockPrisma: {
    action: {
      findMany: vi.fn(),
    },
    paymentRequest: {
      findMany: vi.fn(),
    },
  },
  mockRequireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  Network: {
    MAINNET: "MAINNET",
    TESTNET: "TESTNET",
  },
  PaymentRequestStatus: {
    CONFIRMED: "CONFIRMED",
  },
  prisma: mockPrisma,
}));

vi.mock("@/lib/creator-guard", () => ({
  requireCreator: mockRequireCreator,
}));

vi.mock("@/lib/indexer", () => ({
  getKaspaIndexer: mockGetKaspaIndexer,
}));

import { GET, POST } from "./route";

function request() {
  return new Request("https://example.com/api/creator/action-payments");
}

describe("GET /api/creator/action-payments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1", username: "ada" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockPrisma.paymentRequest.findMany.mockResolvedValue([]);
  });

  it("deduplicates identical address scans and fans results back out per Action", async () => {
    const listIncomingPayments = vi.fn(async () => [
      {
        blockTime: 1_770_000_000_000,
        matchedSompi: 123_000_000n,
        outputIndex: 0,
        transactionId: "abcd",
      },
    ]);
    mockPrisma.action.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        network: "MAINNET",
        publicId: "action-1",
        recipientAddress: "kaspa:qshared",
      },
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        network: "MAINNET",
        publicId: "action-2",
        recipientAddress: "kaspa:qshared",
      },
    ]);
    mockGetKaspaIndexer.mockReturnValue({
      listIncomingPayments,
      providerId: "rest:api.kaspa.org",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(listIncomingPayments).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      paymentStates: {
        "action-1": {
          error: null,
          payments: [
            {
              amountKas: "1.23",
              amountSompi: "123000000",
              blockTime: 1_770_000_000_000,
              outputIndex: 0,
              transactionId: "abcd",
            },
          ],
          summary: {
            count: 1,
            providerId: "rest:api.kaspa.org",
            scanLimit: 25,
            totalKas: "1.23",
            totalSompi: "123000000",
          },
        },
        "action-2": {
          error: null,
          payments: [
            {
              amountKas: "1.23",
              amountSompi: "123000000",
              blockTime: 1_770_000_000_000,
              outputIndex: 0,
              transactionId: "abcd",
            },
          ],
          summary: {
            count: 1,
            providerId: "rest:api.kaspa.org",
            scanLimit: 25,
            totalKas: "1.23",
            totalSompi: "123000000",
          },
        },
      },
      recentSupporterMessages: [],
      supporterWallEntries: [],
    });
  });

  it("returns per-Action errors when lookup is unavailable", async () => {
    mockPrisma.action.findMany.mockResolvedValue([
      {
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        network: "MAINNET",
        publicId: "action-1",
        recipientAddress: "kaspa:qshared",
      },
    ]);
    mockGetKaspaIndexer.mockReturnValue(null);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      paymentStates: {
        "action-1": {
          error: "Chain lookup is not configured for this network.",
          payments: [],
          summary: null,
        },
      },
      recentSupporterMessages: [],
      supporterWallEntries: [],
    });
  });

  it("hides receipts that arrived before an action was created", async () => {
    // Action created on 2026-02-01. The address has three receipts on it:
    // one from BEFORE creation (pre-existing balance the creator already had
    // on this address), one from AFTER creation (a real Kaspa-Links earning),
    // and one with no blockTime (we can't prove which side of the cutoff it
    // is on — exclude defensively).
    const created = Date.UTC(2026, 1, 1); // 2026-02-01T00:00:00Z
    const listIncomingPayments = vi.fn(async () => [
      {
        blockTime: created - 86_400_000, // a day before — pre-existing
        matchedSompi: 999_000_000n,
        outputIndex: 0,
        transactionId: "old-tx",
      },
      {
        blockTime: created + 3_600_000, // an hour after — real earning
        matchedSompi: 123_000_000n,
        outputIndex: 0,
        transactionId: "new-tx",
      },
      {
        blockTime: null, // unknown — exclude to stay honest
        matchedSompi: 50_000_000n,
        outputIndex: 0,
        transactionId: "pending-tx",
      },
    ]);
    mockPrisma.action.findMany.mockResolvedValue([
      {
        createdAt: new Date(created),
        network: "MAINNET",
        publicId: "action-1",
        recipientAddress: "kaspa:qshared",
      },
    ]);
    mockGetKaspaIndexer.mockReturnValue({
      listIncomingPayments,
      providerId: "rest:api.kaspa.org",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.paymentStates["action-1"].payments).toEqual([
      {
        amountKas: "1.23",
        amountSompi: "123000000",
        blockTime: created + 3_600_000,
        outputIndex: 0,
        transactionId: "new-tx",
      },
    ]);
    expect(body.paymentStates["action-1"].summary).toEqual({
      count: 1,
      providerId: "rest:api.kaspa.org",
      scanLimit: 25,
      totalKas: "1.23",
      totalSompi: "123000000",
    });
  });

  it("applies the cutoff per Action when two links share the same address", async () => {
    // Earlier link: created Jan 1. Later link: created Feb 1.
    // A receipt that came in between (Jan 15) counts ONLY for the older link
    // — the newer link wasn't earning yet. Without this per-action filter,
    // both links would over-count the same payment.
    const olderCreated = Date.UTC(2026, 0, 1);
    const newerCreated = Date.UTC(2026, 1, 1);
    const receiptTime = Date.UTC(2026, 0, 15);
    const listIncomingPayments = vi.fn(async () => [
      {
        blockTime: receiptTime,
        matchedSompi: 100_000_000n,
        outputIndex: 0,
        transactionId: "mid-tx",
      },
    ]);
    mockPrisma.action.findMany.mockResolvedValue([
      {
        createdAt: new Date(olderCreated),
        network: "MAINNET",
        publicId: "older",
        recipientAddress: "kaspa:qshared",
      },
      {
        createdAt: new Date(newerCreated),
        network: "MAINNET",
        publicId: "newer",
        recipientAddress: "kaspa:qshared",
      },
    ]);
    mockGetKaspaIndexer.mockReturnValue({
      listIncomingPayments,
      providerId: "rest:api.kaspa.org",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.paymentStates.older.payments).toHaveLength(1);
    expect(body.paymentStates.newer.payments).toHaveLength(0);
    expect(body.paymentStates.newer.summary).toEqual({
      count: 0,
      providerId: "rest:api.kaspa.org",
      scanLimit: 25,
      totalKas: "0",
      totalSompi: "0",
    });
  });

  it("returns recent confirmed supporter messages with tx context for the signed-in creator", async () => {
    mockPrisma.action.findMany.mockResolvedValue([]);
    mockPrisma.paymentRequest.findMany
      .mockResolvedValueOnce([
        {
          action: {
            network: "MAINNET",
            publicId: "action-1",
            slug: "tip-jar",
            title: "Tip jar",
          },
          amountSompi: 250_000_000n,
          confirmedAt: new Date("2026-05-17T10:15:00.000Z"),
          supporterMessage: "Great stream",
          txId: "abc123def456",
        },
      ])
      .mockResolvedValueOnce([
        {
          action: {
            network: "MAINNET",
            publicId: "action-1",
            slug: "tip-jar",
            title: "Tip jar",
          },
          amountSompi: 250_000_000n,
          confirmedAt: new Date("2026-05-17T10:15:00.000Z"),
          id: "payment-request-1",
          supporterHiddenAt: null,
          supporterMessage: "Great stream",
          supporterName: "Ada",
          txId: "abc123def456",
        },
      ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      paymentStates: {},
      recentSupporterMessages: [
        {
          actionPublicId: "action-1",
          actionTitle: "Tip jar",
          amountKas: "2.5",
          confirmedAt: "2026-05-17T10:15:00.000Z",
          message: "Great stream",
          network: "mainnet",
          sharePath: "/u/ada/tip-jar",
          txId: "abc123def456",
        },
      ],
      supporterWallEntries: [
        {
          actionPublicId: "action-1",
          actionTitle: "Tip jar",
          amountKas: "2.5",
          confirmedAt: "2026-05-17T10:15:00.000Z",
          hidden: false,
          id: "payment-request-1",
          message: "Great stream",
          network: "mainnet",
          sharePath: "/u/ada/tip-jar",
          supporterName: "Ada",
          txId: "abc123def456",
        },
      ],
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
