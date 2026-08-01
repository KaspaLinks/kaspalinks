import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  enforceRateLimitMock,
  mockPrisma,
  reconcileGiveawayPrizeMock,
  requireCreatorMock,
  writeAuditLogMock,
} = vi.hoisted(() => ({
  enforceRateLimitMock: vi.fn(),
  mockPrisma: {
    giveaway: { delete: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
  },
  reconcileGiveawayPrizeMock: vi.fn(),
  requireCreatorMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  GiveawayStatus: { DRAWN: "DRAWN", NO_ENTRIES: "NO_ENTRIES" },
  prisma: mockPrisma,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: requireCreatorMock }));
vi.mock("@/lib/giveaway-prize", () => ({
  reconcileGiveawayPrize: reconcileGiveawayPrizeMock,
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: enforceRateLimitMock,
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_MUTATION: "toccata-lab.giveaway-mutation" },
}));

import { DELETE, GET } from "./route";

function giveaway() {
  return {
    _count: { entries: 0 },
    amountSompi: 1_000_000_000n,
    closesAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    creatorId: "creator-1",
    description: "A test giveaway",
    drawCommitment: "a".repeat(64),
    drawDigest: null,
    drawSeedHex: "b".repeat(64),
    entries: [],
    entryWindowSeconds: 60,
    entryCountAtDraw: null,
    id: "giveaway-db-1",
    openedAt: null as Date | null,
    prizeLink: {
      amountSompi: 1_000_200_000n,
      claimTxId: null,
      createdAt: new Date(),
      feeSompi: 200_000n,
      fundingAddress: `kaspa:${"q".repeat(61)}`,
      fundingOutputIndex: null as number | null,
      fundingTxId: null as string | null,
      id: "prize-db-1",
      linkKey: "giveaway-prize-1",
      redeemScriptHex: "private-no-public-need",
      refundLockTime: "123456",
      refundTxId: null,
      status: "awaiting_funding",
    },
    publicId: "giveaway-1",
    status: "OPEN",
    title: "Test giveaway",
    winnerAddress: null,
    winnerClaimExpiresAt: null,
    winnerEntryId: null,
    winnerIndex: null,
    prizeClaimTransactionId: null,
    prizeClaimTransactionSafeJson: null,
  };
}

describe("GET /api/toccata-lab/giveaways/[publicId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    enforceRateLimitMock.mockReturnValue({ allowed: true, result: {} });
    requireCreatorMock.mockResolvedValue({
      creator: { id: "creator-1", username: "creator" },
      ipHash: "ip-hash",
      ok: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps an unfunded prize private and the entry window closed", async () => {
    const pending = giveaway();
    mockPrisma.giveaway.findUnique.mockResolvedValue(pending);
    reconcileGiveawayPrizeMock.mockResolvedValue(pending);

    const response = await GET(new Request("https://kaspalinks.com"), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      giveaway: { prize: null, status: "PENDING_FUNDING" },
    });
  });

  it("publishes verifiable funding metadata but never browser recovery material", async () => {
    const funded = giveaway();
    funded.openedAt = new Date();
    funded.prizeLink.fundingOutputIndex = 0;
    funded.prizeLink.fundingTxId = "c".repeat(64);
    funded.prizeLink.status = "funded";
    mockPrisma.giveaway.findUnique.mockResolvedValue(funded);
    reconcileGiveawayPrizeMock.mockResolvedValue(funded);

    const response = await GET(new Request("https://kaspalinks.com"), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });
    const body = await response.json();

    expect(body.giveaway.prize).toEqual({
      claimTxId: null,
      fundingAddress: funded.prizeLink.fundingAddress,
      fundingTxId: funded.prizeLink.fundingTxId,
      paidOut: false,
    });
    expect(JSON.stringify(body)).not.toContain("claimCode");
    expect(JSON.stringify(body)).not.toContain("refundCode");
    expect(JSON.stringify(body)).not.toContain("redeemScriptHex");
  });
});

describe("DELETE /api/toccata-lab/giveaways/[publicId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    enforceRateLimitMock.mockReturnValue({ allowed: true, result: {} });
    requireCreatorMock.mockResolvedValue({
      creator: { id: "creator-1", username: "creator" },
      ipHash: "ip-hash",
      ok: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("deletes an unfunded giveaway without touching its prize record", async () => {
    const pending = giveaway();
    mockPrisma.giveaway.findFirst.mockResolvedValue(pending);
    mockPrisma.giveaway.delete.mockResolvedValue(pending);
    reconcileGiveawayPrizeMock.mockResolvedValue(pending);

    const response = await DELETE(new Request("https://kaspalinks.com", { method: "DELETE" }), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true, publicId: "giveaway-1" });
    expect(reconcileGiveawayPrizeMock).toHaveBeenCalledWith(pending, expect.any(Date), {
      force: true,
    });
    expect(mockPrisma.giveaway.delete).toHaveBeenCalledWith({ where: { id: pending.id } });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ event: "giveaway.deleted" }),
    );
  });

  it("refuses to delete while the parked prize is still spendable", async () => {
    const funded = giveaway();
    funded.prizeLink.fundingOutputIndex = 0;
    funded.prizeLink.fundingTxId = "c".repeat(64);
    funded.prizeLink.status = "funded";
    mockPrisma.giveaway.findFirst.mockResolvedValue(funded);
    reconcileGiveawayPrizeMock.mockResolvedValue(funded);

    const response = await DELETE(new Request("https://kaspalinks.com", { method: "DELETE" }), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(409);
    expect(mockPrisma.giveaway.delete).not.toHaveBeenCalled();
  });

  it.each(["claimed", "refunded"])("deletes a giveaway after its prize is %s", async (status) => {
    const closed = giveaway();
    closed.prizeLink.fundingOutputIndex = 0;
    closed.prizeLink.fundingTxId = "c".repeat(64);
    closed.prizeLink.status = status;
    mockPrisma.giveaway.findFirst.mockResolvedValue(closed);
    mockPrisma.giveaway.delete.mockResolvedValue(closed);
    reconcileGiveawayPrizeMock.mockResolvedValue(closed);

    const response = await DELETE(new Request("https://kaspalinks.com", { method: "DELETE" }), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(200);
    expect(mockPrisma.giveaway.delete).toHaveBeenCalledWith({ where: { id: closed.id } });
  });

  it("keeps the giveaway when on-chain verification is unavailable", async () => {
    const pending = giveaway();
    mockPrisma.giveaway.findFirst.mockResolvedValue(pending);
    reconcileGiveawayPrizeMock.mockRejectedValue(new Error("indexer unavailable"));

    const response = await DELETE(new Request("https://kaspalinks.com", { method: "DELETE" }), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(503);
    expect(mockPrisma.giveaway.delete).not.toHaveBeenCalled();
  });
});
