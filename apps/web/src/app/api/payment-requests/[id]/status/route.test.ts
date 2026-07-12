import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    auditLog: {
      create: vi.fn(),
    },
    paymentRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: {
    SYSTEM: "SYSTEM",
  },
  PaymentRequestStatus: {
    CONFIRMED: "CONFIRMED",
    EXPIRED: "EXPIRED",
    FAILED: "FAILED",
    PENDING: "PENDING",
  },
  Prisma: {},
  prisma: mockPrisma,
}));

import { GET, POST } from "./route";

function routeContext(id = "payment-request-1") {
  return {
    params: Promise.resolve({ id }),
  };
}

function request() {
  return new Request("https://example.com/api/payment-requests/payment-request-1/status", {
    headers: {
      "x-forwarded-for": "203.0.113.10",
    },
  });
}

function requestWithQuery(query: string) {
  return new Request(`https://example.com/api/payment-requests/payment-request-1/status?${query}`, {
    headers: {
      "x-forwarded-for": "203.0.113.10",
    },
  });
}

function paymentRequest(overrides: Record<string, unknown> = {}) {
  return {
    actionId: "action-1",
    amountSompi: 1_000_000_000n,
    confirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-01T00:15:00.000Z"),
    failedAt: null,
    fakeTxId: null,
    id: "payment-request-1",
    network: "TESTNET",
    paymentUri: "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz?amount=10",
    recipientAddress: "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz",
    requestedMessage: null,
    status: "PENDING",
    supporterHiddenAt: null,
    supporterMessage: null,
    supporterName: null,
    supporterPublic: false,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("GET /api/payment-requests/:id/status", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRateLimits();
  });

  it("returns JSON 404 for missing payment requests", async () => {
    mockPrisma.paymentRequest.findUnique.mockResolvedValue(null);

    const response = await GET(request(), routeContext());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Payment request not found.",
      },
    });
  });

  it("rejects malformed reported transaction ids", async () => {
    const response = await GET(requestWithQuery("txId=not-a-real-txid"), routeContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BODY",
        message: "Invalid status query parameters.",
      },
    });
  });

  it("lazy-expires pending requests and writes an AuditLog", async () => {
    const expiredPending = paymentRequest({
      expiresAt: new Date("2025-12-31T23:59:00.000Z"),
    });
    const expired = paymentRequest({
      expiresAt: new Date("2025-12-31T23:59:00.000Z"),
      failedAt: new Date("2026-01-01T00:16:00.000Z"),
      status: "EXPIRED",
    });

    mockPrisma.paymentRequest.findUnique
      .mockResolvedValueOnce(expiredPending)
      .mockResolvedValueOnce(expired);
    mockPrisma.paymentRequest.updateMany.mockResolvedValue({ count: 1 });

    const response = await GET(request(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.updateMany).toHaveBeenCalledWith({
      data: {
        failedAt: expect.any(Date),
        status: "EXPIRED",
      },
      where: { id: "payment-request-1", status: "PENDING" },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionId: "action-1",
        event: "payment_request.lazy_expired",
        paymentRequestId: "payment-request-1",
      }),
    });
    expect(body.paymentRequest.status).toBe("EXPIRED");
  });

  it("does not expire a request that was confirmed by a concurrent poll", async () => {
    const expiredPending = paymentRequest({
      expiresAt: new Date("2025-12-31T23:59:00.000Z"),
    });
    const confirmed = paymentRequest({
      confirmedAt: new Date("2026-01-01T00:15:59.000Z"),
      expiresAt: new Date("2025-12-31T23:59:00.000Z"),
      status: "CONFIRMED",
      txId: "a".repeat(64),
    });
    mockPrisma.paymentRequest.findUnique
      .mockResolvedValueOnce(expiredPending)
      .mockResolvedValueOnce(confirmed);
    mockPrisma.paymentRequest.updateMany.mockResolvedValue({ count: 0 });

    const response = await GET(request(), routeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      paymentRequest: { status: "CONFIRMED", txId: "a".repeat(64) },
    });
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", async () => {
    const response = POST();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Allowed methods: GET.",
      },
    });
  });

  it("rate-limits excessive status polling from one client IP", async () => {
    mockPrisma.paymentRequest.findUnique.mockResolvedValue(
      paymentRequest({
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );

    for (let index = 0; index < 120; index += 1) {
      const response = await GET(request(), routeContext());
      expect(response.status).toBe(200);
    }

    const response = await GET(request(), routeContext());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please retry later.",
      },
    });
  });
});
