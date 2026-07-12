import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetKaspaIndexer, mockPrisma, mockRequireCreator } = vi.hoisted(() => ({
  mockGetKaspaIndexer: vi.fn(),
  mockPrisma: {
    action: {
      findFirst: vi.fn(),
    },
  },
  mockRequireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  Network: {
    MAINNET: "MAINNET",
    TESTNET: "TESTNET",
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

function routeContext(publicId = "cmp441jyk000101o4skawavjg") {
  return {
    params: Promise.resolve({ publicId }),
  };
}

function request() {
  return new Request("https://example.com/api/creator/actions/cmp441jyk000101o4skawavjg/payments");
}

describe("GET /api/creator/actions/:publicId/payments", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
  });

  it("returns post-creation address receipts as JSON-safe strings", async () => {
    const created = Date.UTC(2026, 0, 1);
    mockPrisma.action.findFirst.mockResolvedValue({
      createdAt: new Date(created),
      network: "MAINNET",
      publicId: "cmp441jyk000101o4skawavjg",
      recipientAddress: "kaspa:qexample",
    });
    mockGetKaspaIndexer.mockReturnValue({
      async listIncomingPayments() {
        // Indexer returns dated + undated; the route's notBefore filter
        // already prunes anything pre-creation, and the route's secondary
        // blockTime check excludes nulls that the indexer happens to leak.
        return [
          {
            blockTime: 1_770_000_000_000, // 2026-02-25 → after creation
            matchedSompi: 123_000_000n,
            outputIndex: 0,
            transactionId: "abcd",
          },
          {
            blockTime: null, // can't prove post-creation → excluded
            matchedSompi: 77_000_000n,
            outputIndex: 1,
            transactionId: "efgh",
          },
        ];
      },
      providerId: "rest:api.kaspa.org",
    });

    const response = await GET(request(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      action: {
        network: "mainnet",
        publicId: "cmp441jyk000101o4skawavjg",
        recipientAddress: "kaspa:qexample",
      },
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
    });
  });

  it("forwards the action createdAt as notBefore to the indexer", async () => {
    const created = Date.UTC(2026, 1, 1);
    const listIncomingPayments = vi.fn(async () => []);
    mockPrisma.action.findFirst.mockResolvedValue({
      createdAt: new Date(created),
      network: "MAINNET",
      publicId: "cmp441jyk000101o4skawavjg",
      recipientAddress: "kaspa:qexample",
    });
    mockGetKaspaIndexer.mockReturnValue({
      listIncomingPayments,
      providerId: "rest:api.kaspa.org",
    });

    await GET(request(), routeContext());

    expect(listIncomingPayments).toHaveBeenCalledWith(
      expect.objectContaining({
        notBefore: created,
        recipientAddress: "kaspa:qexample",
      }),
    );
  });

  it("returns 503 when chain lookup is unavailable for the network", async () => {
    mockPrisma.action.findFirst.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      network: "TESTNET",
      publicId: "cmp441jyk000101o4skawavjg",
      recipientAddress: "kaspatest:qexample",
    });
    mockGetKaspaIndexer.mockReturnValue(null);

    const response = await GET(request(), routeContext());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CHAIN_LOOKUP_DISABLED",
        message: "Chain lookup is not configured for this network.",
      },
    });
  });

  it("rejects malformed public IDs before querying", async () => {
    const response = await GET(request(), routeContext("../bad"));

    expect(response.status).toBe(400);
    expect(mockPrisma.action.findFirst).not.toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
