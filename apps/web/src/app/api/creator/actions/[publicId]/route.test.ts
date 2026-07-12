import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRequireCreator, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: {
    action: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
  mockRequireCreator: vi.fn(),
  mockWriteAuditLog: vi.fn(),
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
    CREATOR: "CREATOR",
  },
  Network: {
    MAINNET: "MAINNET",
    TESTNET: "TESTNET",
  },
  prisma: mockPrisma,
}));

vi.mock("@/lib/creator-guard", () => ({
  requireCreator: mockRequireCreator,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

import { DELETE, GET, PATCH } from "./route";

function routeContext(publicId = "cmp441jyk000101o4skawavjg") {
  return {
    params: Promise.resolve({ publicId }),
  };
}

function request(body: unknown) {
  return new Request("https://example.com/api/creator/actions/cmp441jyk000101o4skawavjg", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    amountSompi: 100_000_000n,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    description: "Old description",
    disabledAt: null,
    goalAutoClose: false,
    goalSompi: null,
    id: "action-1",
    message: "Old message",
    network: "MAINNET",
    noteRequired: false,
    publicId: "cmp441jyk000101o4skawavjg",
    recipientAddress: "kaspa:qexample",
    slug: "tip",
    title: "Old title",
    type: "KASPA_TIP",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("PATCH /api/creator/actions/:publicId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1", username: "ada" },
      ipHash: "ip-hash",
      ok: true,
    });
  });

  it("updates safe creator-owned Action fields without changing the recipient", async () => {
    const original = action();
    const updated = action({
      amountSompi: 125_000_000n,
      description: "New description",
      message: "New wallet note",
      noteRequired: true,
      title: "New title",
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    mockPrisma.action.findFirst.mockResolvedValue(original);
    mockPrisma.action.update.mockResolvedValue(updated);

    const response = await PATCH(
      request({
        amountKas: "1.25",
        description: " New description ",
        message: " New wallet note ",
        noteRequired: true,
        title: " New title ",
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.action.update).toHaveBeenCalledWith({
      data: {
        amountSompi: 125_000_000n,
        description: "New description",
        message: "New wallet note",
        noteRequired: true,
        title: "New title",
      },
      where: { id: "action-1" },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        event: "creator.action_updated",
        metadata: expect.objectContaining({
          updatedFields: ["title", "description", "message", "noteRequired", "amountSompi"],
          variableAmount: false,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      action: {
        amountKas: "1.25",
        description: "New description",
        message: "New wallet note",
        noteRequired: true,
        recipientAddress: "kaspa:qexample",
        title: "New title",
      },
    });
  });

  it("rejects clearing the amount on fixed-amount Action types", async () => {
    mockPrisma.action.findFirst.mockResolvedValue(action({ type: "KASPA_INVOICE" }));

    const response = await PATCH(request({ amountKas: "" }), routeContext());

    expect(response.status).toBe(400);
    expect(mockPrisma.action.update).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BODY",
        message: "kaspa.invoice requires a fixed amount.",
      },
    });
  });

  it("updates goal auto-close on goal links", async () => {
    const original = action({ goalSompi: 10_000_000_000n, type: "KASPA_GOAL" });
    const updated = action({
      goalAutoClose: true,
      goalSompi: 10_000_000_000n,
      type: "KASPA_GOAL",
    });
    mockPrisma.action.findFirst.mockResolvedValue(original);
    mockPrisma.action.update.mockResolvedValue(updated);

    const response = await PATCH(request({ goalAutoClose: true }), routeContext());

    expect(response.status).toBe(200);
    expect(mockPrisma.action.update).toHaveBeenCalledWith({
      data: { goalAutoClose: true },
      where: { id: "action-1" },
    });
    await expect(response.json()).resolves.toMatchObject({
      action: { goalAutoClose: true },
    });
  });

  it("updates the target amount on goal links", async () => {
    const original = action({ goalSompi: 10_000_000_000n, type: "KASPA_GOAL" });
    const updated = action({
      goalSompi: 50_000_000_000n,
      type: "KASPA_GOAL",
    });
    mockPrisma.action.findFirst.mockResolvedValue(original);
    mockPrisma.action.update.mockResolvedValue(updated);

    const response = await PATCH(request({ goalKas: "500" }), routeContext());

    expect(response.status).toBe(200);
    expect(mockPrisma.action.update).toHaveBeenCalledWith({
      data: { goalSompi: 50_000_000_000n },
      where: { id: "action-1" },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        metadata: expect.objectContaining({
          updatedFields: ["goalSompi"],
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      action: { goalKas: "500" },
    });
  });

  it("rejects fixed payment amounts on goal links", async () => {
    mockPrisma.action.findFirst.mockResolvedValue(action({ type: "KASPA_GOAL" }));

    const response = await PATCH(request({ amountKas: "5" }), routeContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BODY",
        message: "Goal links use a target amount, not a fixed payment amount.",
      },
    });
    expect(mockPrisma.action.update).not.toHaveBeenCalled();
  });

  it("rejects goal auto-close on non-goal links", async () => {
    mockPrisma.action.findFirst.mockResolvedValue(action({ type: "KASPA_TIP" }));

    const response = await PATCH(request({ goalAutoClose: true }), routeContext());

    expect(response.status).toBe(400);
    expect(mockPrisma.action.update).not.toHaveBeenCalled();
  });

  it("rejects goal targets on non-goal links", async () => {
    mockPrisma.action.findFirst.mockResolvedValue(action({ type: "KASPA_TIP" }));

    const response = await PATCH(request({ goalKas: "500" }), routeContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_BODY",
        message: "Only goal links can update a goal target.",
      },
    });
    expect(mockPrisma.action.update).not.toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("DELETE, PATCH");
  });
});

describe("DELETE /api/creator/actions/:publicId", () => {
  it("keeps delete available", async () => {
    const original = action();
    mockPrisma.action.findFirst.mockResolvedValue(original);
    mockPrisma.action.update.mockResolvedValue({
      ...original,
      deletedAt: new Date("2026-01-03T00:00:00.000Z"),
      disabledAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1", username: "ada" },
      ipHash: "ip-hash",
      ok: true,
    });

    const response = await DELETE(
      new Request("https://example.com/api/creator/actions/cmp441jyk000101o4skawavjg", {
        method: "DELETE",
      }),
      routeContext(),
    );

    expect(response.status).toBe(200);
  });
});
