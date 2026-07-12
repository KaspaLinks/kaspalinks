import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    paymentRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  Prisma: {},
  prisma: mockPrisma,
}));

import { GET, PATCH } from "./route";

function routeContext(id = "payment-request-1") {
  return {
    params: Promise.resolve({ id }),
  };
}

function request(body: unknown) {
  return new Request(
    "https://example.com/api/payment-requests/payment-request-1/supporter-message",
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.10",
      },
      method: "PATCH",
    },
  );
}

function paymentRequest(overrides: Record<string, unknown> = {}) {
  return {
    actionId: "action-1",
    amountSompi: 1_000_000_000n,
    confirmedAt: null,
    createdAt: new Date("2026-05-17T10:00:00.000Z"),
    detectionSource: null,
    expiresAt: new Date(Date.now() + 60_000),
    failedAt: null,
    fakeTxId: null,
    id: "payment-request-1",
    network: "MAINNET",
    paymentUri: "kaspa:qexample?amount=10",
    recipientAddress: "kaspa:qexample",
    requestedMessage: null,
    status: "PENDING",
    supporterMessage: null,
    supporterName: null,
    supporterPublic: false,
    supporterHiddenAt: null,
    txId: null,
    updatedAt: new Date("2026-05-17T10:00:00.000Z"),
    ...overrides,
  };
}

describe("PATCH /api/payment-requests/:id/supporter-message", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRateLimits();
  });

  it("updates supporter messages while the request is pending", async () => {
    const pending = paymentRequest();
    const updated = paymentRequest({ supporterMessage: "Great stream" });
    mockPrisma.paymentRequest.findUnique.mockResolvedValue(pending);
    mockPrisma.paymentRequest.update.mockResolvedValue(updated);

    const response = await PATCH(request({ supporterMessage: " Great stream " }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
      data: { supporterMessage: "Great stream", supporterName: null, supporterPublic: false },
      where: { id: "payment-request-1" },
    });
    expect(body.paymentRequest.supporterMessage).toBe("Great stream");
  });

  it("updates public supporter wall attribution while the request is pending", async () => {
    const pending = paymentRequest();
    const updated = paymentRequest({
      supporterMessage: "Great stream",
      supporterName: "Ada",
      supporterPublic: true,
    });
    mockPrisma.paymentRequest.findUnique.mockResolvedValue(pending);
    mockPrisma.paymentRequest.update.mockResolvedValue(updated);

    const response = await PATCH(
      request({
        supporterMessage: " Great stream ",
        supporterName: " Ada ",
        supporterPublic: true,
      }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
      data: {
        supporterMessage: "Great stream",
        supporterName: "Ada",
        supporterPublic: true,
      },
      where: { id: "payment-request-1" },
    });
    expect(body.paymentRequest.supporterName).toBe("Ada");
    expect(body.paymentRequest.supporterPublic).toBe(true);
  });

  it("rejects updates after confirmation", async () => {
    mockPrisma.paymentRequest.findUnique.mockResolvedValue(paymentRequest({ status: "CONFIRMED" }));

    const response = await PATCH(request({ supporterMessage: "late" }), routeContext());

    expect(response.status).toBe(409);
    expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PATCH");
  });
});
