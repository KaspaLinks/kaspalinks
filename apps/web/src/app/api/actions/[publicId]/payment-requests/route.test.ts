import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    auditLog: {
      create: vi.fn(),
    },
    action: {
      findUnique: vi.fn(),
    },
    paymentRequest: {
      aggregate: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  ActionType: {
    KASPA_DONATION: "KASPA_DONATION",
    KASPA_GOAL: "KASPA_GOAL",
    KASPA_INVOICE: "KASPA_INVOICE",
    KASPA_TIP: "KASPA_TIP",
    KASPA_TRANSFER: "KASPA_TRANSFER",
  },
  AuditActorType: {
    PUBLIC: "PUBLIC",
  },
  PaymentRequestStatus: {
    CONFIRMED: "CONFIRMED",
  },
  Prisma: {},
  prisma: mockPrisma,
}));

import { GET, POST } from "./route";

function request(body: unknown) {
  const json = JSON.stringify(body);
  return new Request("https://example.com/api/actions/demo-action/payment-requests", {
    body: json,
    headers: {
      "content-length": String(json.length),
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10",
    },
    method: "POST",
  });
}

function routeContext(publicId = "demo-action") {
  return {
    params: Promise.resolve({ publicId }),
  };
}

function action(
  overrides: Partial<{
    amountSompi: bigint | null;
    goalAutoClose: boolean;
    goalSompi: bigint | null;
    noteRequired: boolean;
    type: string;
  }> = {},
) {
  return {
    amountSompi: 1_000_000_000n,
    deletedAt: null,
    disabledAt: null,
    expiresAt: null,
    goalAutoClose: false,
    goalSompi: null,
    id: "action-1",
    message: null,
    network: "MAINNET",
    noteRequired: false,
    publicId: "demo-action",
    recipientAddress: "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
    title: "Tip jar",
    type: "KASPA_TIP",
    ...overrides,
  };
}

function paymentRequest(overrides: Record<string, unknown> = {}) {
  return {
    actionId: "action-1",
    amountSompi: 1_000_000_000n,
    confirmedAt: null,
    createdAt: new Date("2026-05-17T10:00:00.000Z"),
    detectionSource: null,
    expiresAt: new Date("2026-05-17T10:15:00.000Z"),
    failedAt: null,
    fakeTxId: null,
    id: "payment-request-1",
    network: "MAINNET",
    paymentUri:
      "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j?amount=10&label=Tip%20jar",
    recipientAddress: "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
    requestedMessage: null,
    status: "PENDING",
    supporterMessage: "Great stream",
    supporterName: null,
    supporterPublic: false,
    supporterHiddenAt: null,
    txId: null,
    updatedAt: new Date("2026-05-17T10:00:00.000Z"),
    ...overrides,
  };
}

describe("POST /api/actions/:publicId/payment-requests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRateLimits();
  });

  it("stores optional supporter messages separately from wallet URI messages", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action());
    mockPrisma.paymentRequest.create.mockResolvedValue(paymentRequest());

    const response = await POST(request({ supporterMessage: " Great stream " }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockPrisma.paymentRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestedMessage: null,
        supporterMessage: "Great stream",
      }),
    });
    expect(body.paymentRequest.supporterMessage).toBe("Great stream");
  });

  it("stores public supporter wall opt-in with an optional display name", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action());
    mockPrisma.paymentRequest.create.mockResolvedValue(
      paymentRequest({
        supporterName: "Ada",
        supporterPublic: true,
      }),
    );

    const response = await POST(
      request({
        supporterMessage: "Great stream",
        supporterName: " Ada ",
        supporterPublic: true,
      }),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockPrisma.paymentRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supporterMessage: "Great stream",
        supporterName: "Ada",
        supporterPublic: true,
      }),
    });
    expect(body.paymentRequest.supporterName).toBe("Ada");
    expect(body.paymentRequest.supporterPublic).toBe(true);
  });

  it("rejects payment requests on note-required actions when the supporter message is empty", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ noteRequired: true }));

    // Whitespace-only counts as empty after the .trim() the server applies.
    const response = await POST(request({ supporterMessage: "   " }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toMatch(/note/i);
    expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects payment requests when the note is below the minimum length", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ noteRequired: true }));

    // Single character — the previous gate let this slip; now the min-length
    // rule must catch it.
    const response = await POST(request({ supporterMessage: "a" }), routeContext());

    expect(response.status).toBe(400);
    expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects payment requests right below the minimum length boundary", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ noteRequired: true }));

    // 9 characters — one short of the 10-char minimum.
    const response = await POST(request({ supporterMessage: "Cat sketc" }), routeContext());

    expect(response.status).toBe(400);
    expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("accepts payment requests on note-required actions when a real note is provided", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ noteRequired: true }));
    mockPrisma.paymentRequest.create.mockResolvedValue(paymentRequest());

    const response = await POST(
      request({ supporterMessage: "Please draw a tabby cat" }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.paymentRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ supporterMessage: "Please draw a tabby cat" }),
    });
  });

  it("rejects fixed-action payment requests below the reliable wallet minimum", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ amountSompi: 1_000_000n }));

    const response = await POST(request({}), routeContext());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("at least 0.2 KAS");
    expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("rejects variable payment request amounts below the reliable wallet minimum", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(action({ amountSompi: null }));

    const response = await POST(request({ amountKas: "0.01" }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("at least 0.2 KAS");
    expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
  });

  it("blocks new payment requests for auto-closed goals that reached their target", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(
      action({
        amountSompi: null,
        goalAutoClose: true,
        goalSompi: 10_000_000_000n,
        type: "KASPA_GOAL",
      }),
    );
    mockPrisma.paymentRequest.aggregate.mockResolvedValue({
      _sum: { amountSompi: 10_000_000_000n },
    });

    const response = await POST(request({ amountKas: "1" }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("GOAL_CLOSED");
    expect(mockPrisma.paymentRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: "goal.payment_request_blocked_after_target",
      }),
    });
  });

  it("allows auto-closed goals while they are still below target", async () => {
    mockPrisma.action.findUnique.mockResolvedValue(
      action({
        amountSompi: null,
        goalAutoClose: true,
        goalSompi: 10_000_000_000n,
        type: "KASPA_GOAL",
      }),
    );
    mockPrisma.paymentRequest.aggregate.mockResolvedValue({
      _sum: { amountSompi: 9_000_000_000n },
    });
    mockPrisma.paymentRequest.create.mockResolvedValue({
      ...paymentRequest(),
      amountSompi: 100_000_000n,
    });

    const response = await POST(request({ amountKas: "1" }), routeContext());

    expect(response.status).toBe(201);
    expect(mockPrisma.paymentRequest.create).toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});
