import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnforceRateLimit,
  mockFormatSompiToKaspa,
  mockParseKaspaAmountToSompi,
  mockParseSompiAmount,
  mockPrisma,
  mockReadCreatorActionDailyLimit,
  mockRequireCreator,
  mockRollingDailyWindowStart,
  mockValidateKaspaAddress,
  mockWriteAuditLog,
} = vi.hoisted(() => {
  const action = {
    count: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  };
  const creator = {
    updateMany: vi.fn(),
  };
  return {
    mockEnforceRateLimit: vi.fn(),
    mockFormatSompiToKaspa: vi.fn(),
    mockParseKaspaAmountToSompi: vi.fn(),
    mockParseSompiAmount: vi.fn(),
    mockPrisma: { action, creator },
    mockReadCreatorActionDailyLimit: vi.fn(),
    mockRequireCreator: vi.fn(),
    mockRollingDailyWindowStart: vi.fn(),
    mockValidateKaspaAddress: vi.fn(),
    mockWriteAuditLog: vi.fn(),
  };
});

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

vi.mock("@kaspa-actions/kaspa", () => ({
  formatSompiToKaspa: mockFormatSompiToKaspa,
  parseKaspaAmountToSompi: mockParseKaspaAmountToSompi,
  parseSompiAmount: mockParseSompiAmount,
  stringifyWithBigInts: (value: unknown) =>
    JSON.stringify(value, (_key, nestedValue) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
    ),
  validateKaspaAddress: mockValidateKaspaAddress,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: mockWriteAuditLog,
}));

vi.mock("@/lib/creator-auth", () => ({
  readCreatorActionDailyLimit: mockReadCreatorActionDailyLimit,
  rollingDailyWindowStart: mockRollingDailyWindowStart,
  serializeSafeCreator: (creator: { createdAt: Date }) => ({
    ...creator,
    createdAt: creator.createdAt.toISOString(),
  }),
}));

vi.mock("@/lib/creator-guard", () => ({
  requireCreator: mockRequireCreator,
}));

vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mockEnforceRateLimit,
  RateBuckets: {
    CREATOR_ACTION_CREATE: "creator.action.create",
  },
}));

import { POST } from "./route";

const ACTION_CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

function postRequest(body: unknown) {
  return new Request("https://example.com/api/creator/actions", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    recipientAddress: "kaspa:qpy6l7q6apd79nqw00drvjtr83hrj95ma582r0g24ttlpuh57hmecd09de4en",
    slug: "support",
    title: "Support my work",
    type: "kaspa.donation",
    ...overrides,
  };
}

describe("POST /api/creator/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: {
        bio: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        displayName: null,
        id: "creator-1",
        tipActionId: null,
        username: "ada",
      },
      ipHash: "ip-hash",
      ok: true,
    });
    mockEnforceRateLimit.mockReturnValue({ allowed: true, result: {} });
    mockReadCreatorActionDailyLimit.mockReturnValue(50);
    mockRollingDailyWindowStart.mockReturnValue(new Date("2025-12-31T00:00:00.000Z"));
    mockValidateKaspaAddress.mockReturnValue({ network: "mainnet", valid: true });
    mockParseKaspaAmountToSompi.mockReturnValue(100_000_000n);
    mockParseSompiAmount.mockReturnValue(100_000_000n);
    mockFormatSompiToKaspa.mockImplementation((value: bigint) =>
      value === 100_000_000n ? "1" : value.toString(),
    );
    mockPrisma.action.count.mockResolvedValue(0);
    mockPrisma.action.findFirst.mockResolvedValue(null);
    mockPrisma.action.create.mockImplementation(async ({ data }) => ({
      amountSompi: data.amountSompi ?? null,
      createdAt: ACTION_CREATED_AT,
      deletedAt: null,
      description: data.description ?? null,
      disabledAt: null,
      goalAutoClose: data.goalAutoClose ?? false,
      goalSompi: data.goalSompi ?? null,
      hiddenFromProfile: data.hiddenFromProfile,
      id: "action-1",
      message: data.message ?? null,
      network: data.network,
      noteRequired: data.noteRequired,
      publicId: "public-1",
      recipientAddress: data.recipientAddress,
      slug: data.slug,
      title: data.title,
      type: data.type,
      updatedAt: ACTION_CREATED_AT,
    }));
    mockPrisma.creator.updateMany.mockResolvedValue({ count: 1 });
    mockWriteAuditLog.mockResolvedValue(undefined);
  });

  it("stores goal auto-close when creating a goal link", async () => {
    const response = await POST(
      postRequest(
        basePayload({
          goalAutoClose: true,
          goalKas: "100",
          slug: "server-fund",
          type: "kaspa.goal",
        }),
      ),
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.action.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        goalAutoClose: true,
        goalSompi: 100_000_000n,
        type: "KASPA_GOAL",
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      action: {
        goalAutoClose: true,
        type: "kaspa.goal",
      },
    });
  });

  it("promotes the first visible creator link to the profile quick-tip card", async () => {
    const response = await POST(postRequest(basePayload()));

    expect(response.status).toBe(201);
    expect(mockPrisma.creator.updateMany).toHaveBeenCalledWith({
      data: { tipActionId: "action-1" },
      where: { id: "creator-1", tipActionId: null },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        event: "creator.action_created",
        metadata: expect.objectContaining({ quickTipAutoAssigned: true }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      action: {
        hiddenFromProfile: false,
        id: "action-1",
        title: "Support my work",
        type: "kaspa.donation",
      },
    });
  });

  it("auto-suffixes the slug when the requested creator slug already exists", async () => {
    mockPrisma.action.findFirst
      .mockResolvedValueOnce({ id: "existing-action" })
      .mockResolvedValueOnce(null);

    const response = await POST(postRequest(basePayload()));

    expect(response.status).toBe(201);
    expect(mockPrisma.action.findFirst).toHaveBeenNthCalledWith(1, {
      where: { creatorId: "creator-1", slug: "support" },
    });
    expect(mockPrisma.action.findFirst).toHaveBeenNthCalledWith(2, {
      where: { creatorId: "creator-1", slug: "support-2" },
    });
    expect(mockPrisma.action.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: "support-2" }),
    });
    await expect(response.json()).resolves.toMatchObject({
      action: {
        sharePath: "/u/ada/support-2",
        slug: "support-2",
      },
    });
  });

  it("does not overwrite the quick-tip card when a visible profile link already exists", async () => {
    mockPrisma.action.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await POST(postRequest(basePayload({ slug: "second" })));

    expect(response.status).toBe(201);
    expect(mockPrisma.creator.updateMany).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({
        metadata: expect.objectContaining({ quickTipAutoAssigned: false }),
      }),
    );
  });

  it("keeps private-by-default invoices off the profile unless the creator opts in", async () => {
    const response = await POST(
      postRequest(
        basePayload({
          amountKas: "1",
          slug: "invoice-1",
          type: "kaspa.invoice",
        }),
      ),
    );

    expect(response.status).toBe(201);
    expect(mockPrisma.action.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ hiddenFromProfile: true }),
    });
    expect(mockPrisma.creator.updateMany).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      action: {
        amountKas: "1",
        hiddenFromProfile: true,
        type: "kaspa.invoice",
      },
    });
  });
});
