import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma, mockRequireCreator, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: {
    paymentRequest: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  mockRequireCreator: vi.fn(),
  mockWriteAuditLog: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: {
    CREATOR: "CREATOR",
  },
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock("@/lib/creator-guard", () => ({
  requireCreator: mockRequireCreator,
}));

import { GET, PATCH } from "./route";

function request(body?: Record<string, unknown>) {
  return new Request("https://example.com/api/creator/supporter-wall/payment-request-1", {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "content-type": "application/json",
      "x-creator-token": "token",
      "x-creator-username": "ada",
    },
    method: "PATCH",
  });
}

function routeContext(id = "payment-request-1") {
  return {
    params: Promise.resolve({ id }),
  };
}

describe("PATCH /api/creator/supporter-wall/:id", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRateLimits();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1", username: "ada" },
      ipHash: "ip-hash",
      ok: true,
    });
  });

  it("hides a creator-owned public supporter wall entry", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue({
      actionId: "action-1",
      id: "payment-request-1",
      supporterHiddenAt: null,
      supporterPublic: true,
    });
    mockPrisma.paymentRequest.update.mockResolvedValue({
      actionId: "action-1",
      id: "payment-request-1",
    });

    const response = await PATCH(request(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.findFirst).toHaveBeenCalledWith({
      select: {
        actionId: true,
        id: true,
        supporterHiddenAt: true,
        supporterPublic: true,
      },
      where: {
        action: {
          creatorId: "creator-1",
          deletedAt: null,
        },
        id: "payment-request-1",
      },
    });
    expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
      data: { supporterHiddenAt: expect.any(Date) },
      where: { id: "payment-request-1" },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        actionId: "action-1",
        event: "supporter_wall.entry_hidden",
        paymentRequestId: "payment-request-1",
      }),
    );
    expect(body.supporterWallEntry.id).toBe("payment-request-1");
  });

  it("shows (un-hides) a hidden entry when hidden is false", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue({
      actionId: "action-1",
      id: "payment-request-1",
      supporterHiddenAt: new Date("2026-01-01T00:00:00.000Z"),
      supporterPublic: true,
    });
    mockPrisma.paymentRequest.update.mockResolvedValue({
      actionId: "action-1",
      id: "payment-request-1",
    });

    const response = await PATCH(request({ hidden: false }), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.update).toHaveBeenCalledWith({
      data: { supporterHiddenAt: null },
      where: { id: "payment-request-1" },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ event: "supporter_wall.entry_shown" }),
    );
    expect(body.supporterWallEntry.hidden).toBe(false);
  });

  it("no-ops when the entry is already in the requested state", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue({
      actionId: "action-1",
      id: "payment-request-1",
      supporterHiddenAt: null,
      supporterPublic: true,
    });

    const response = await PATCH(request({ hidden: false }), routeContext());

    expect(response.status).toBe(200);
    expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean hidden value", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue({
      actionId: "action-1",
      id: "payment-request-1",
      supporterHiddenAt: null,
      supporterPublic: true,
    });

    const response = await PATCH(request({ hidden: "yes" }), routeContext());

    expect(response.status).toBe(400);
    expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the entry is not owned by the creator", async () => {
    mockPrisma.paymentRequest.findFirst.mockResolvedValue(null);

    const response = await PATCH(request(), routeContext());

    expect(response.status).toBe(404);
    expect(mockPrisma.paymentRequest.update).not.toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", async () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("PATCH");
  });
});
