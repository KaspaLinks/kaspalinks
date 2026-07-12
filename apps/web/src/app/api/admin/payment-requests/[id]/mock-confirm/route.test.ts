import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    auditLog: {
      create: vi.fn(),
    },
    paymentRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: {
    ADMIN: "ADMIN",
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

const ADMIN_TOKEN = "test-admin-token";

function routeContext(id = "payment-request-1") {
  return {
    params: Promise.resolve({ id }),
  };
}

function request() {
  return new Request(
    "https://example.com/api/admin/payment-requests/payment-request-1/mock-confirm",
    {
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        "x-forwarded-for": "203.0.113.10",
      },
      method: "POST",
    },
  );
}

function paymentRequest(overrides: Record<string, unknown> = {}) {
  return {
    actionId: "action-1",
    amountSompi: 1_000_000_000n,
    confirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date(Date.now() + 60_000),
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

describe("POST /api/admin/payment-requests/:id/mock-confirm", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_ACCESS_TOKEN = ADMIN_TOKEN;
    process.env.MOCK_CONFIRM_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.ADMIN_ACCESS_TOKEN;
    delete process.env.MOCK_CONFIRM_ENABLED;
  });

  it("returns 403 and writes an AuditLog when mock-confirm is disabled", async () => {
    process.env.MOCK_CONFIRM_ENABLED = "false";

    const response = await POST(request(), routeContext());

    expect(response.status).toBe(403);
    expect(mockPrisma.paymentRequest.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: "mock_confirm.attempted_while_disabled",
        paymentRequestId: "payment-request-1",
      }),
    });
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MOCK_CONFIRM_DISABLED",
        message: "Mock-confirm is disabled on this deployment.",
      },
    });
  });

  it("confirms a pending payment request exactly once", async () => {
    const pending = paymentRequest();
    const confirmed = paymentRequest({
      confirmedAt: new Date("2026-01-01T00:01:00.000Z"),
      fakeTxId: "mock-confirmed",
      status: "CONFIRMED",
    });

    mockPrisma.paymentRequest.findUnique.mockResolvedValue(pending);
    mockPrisma.paymentRequest.update.mockResolvedValue(confirmed);

    const response = await POST(request(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
      data: {
        confirmedAt: expect.any(Date),
        detectionSource: "mock",
        fakeTxId: expect.stringMatching(/^mock-[0-9a-f]{32}$/),
        status: "CONFIRMED",
      },
      where: { id: "payment-request-1" },
    });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: "payment_request.mock_confirmed",
        paymentRequestId: "payment-request-1",
      }),
    });
    expect(body.paymentRequest.status).toBe("CONFIRMED");
    expect(body.paymentRequest.fakeTxId).toBe("mock-confirmed");
  });

  it("rejects already-confirmed payment requests", async () => {
    mockPrisma.paymentRequest.findUnique.mockResolvedValue(
      paymentRequest({
        confirmedAt: new Date("2026-01-01T00:01:00.000Z"),
        status: "CONFIRMED",
      }),
    );

    const response = await POST(request(), routeContext());

    expect(response.status).toBe(409);
    expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: "mock_confirm.invalid_state_transition",
        metadata: { from: "CONFIRMED", to: "CONFIRMED" },
        paymentRequestId: "payment-request-1",
      }),
    });
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Allowed methods: POST.",
      },
    });
  });
});
