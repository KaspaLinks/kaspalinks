import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  enforceRateLimitMock,
  mockPrisma,
  reconcileGiveawayPrizeMock,
  requireCreatorMock,
  verifyPreparedClaimMock,
  writeAuditLogMock,
} = vi.hoisted(() => ({
  enforceRateLimitMock: vi.fn(),
  mockPrisma: {
    giveaway: { findFirst: vi.fn(), update: vi.fn() },
  },
  reconcileGiveawayPrizeMock: vi.fn(),
  requireCreatorMock: vi.fn(),
  verifyPreparedClaimMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  GiveawayStatus: { DRAWN: "DRAWN" },
  prisma: mockPrisma,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: requireCreatorMock }));
vi.mock("@/lib/giveaway-prize", () => ({
  reconcileGiveawayPrize: reconcileGiveawayPrizeMock,
}));
vi.mock("@/lib/giveaway-prize-claim", () => ({
  verifyPreparedGiveawayPrizeClaim: verifyPreparedClaimMock,
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: enforceRateLimitMock,
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_MUTATION: "giveaway-mutation" },
}));

import { POST } from "./route";

const transactionId = "ab".repeat(32);

function giveaway() {
  return {
    creatorId: "creator-1",
    id: "giveaway-db-1",
    prizeLink: {
      id: "prize-db-1",
      linkKey: "prize-link-1",
      status: "funded",
    },
    publicId: "giveaway-1",
    status: "DRAWN",
    winnerAddress: `kaspa:${"q".repeat(61)}`,
    winnerClaimExpiresAt: new Date(Date.now() + 60_000),
  };
}

function request(body: Record<string, unknown>) {
  return new Request("https://kaspalinks.com/api/toccata-lab/giveaways/giveaway-1/prepare-claim", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/giveaways/[publicId]/prepare-claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    enforceRateLimitMock.mockReturnValue({ allowed: true });
    requireCreatorMock.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockPrisma.giveaway.findFirst.mockResolvedValue(giveaway());
    reconcileGiveawayPrizeMock.mockResolvedValue(giveaway());
    mockPrisma.giveaway.update.mockResolvedValue(giveaway());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores only a verified, already signed fixed-destination transaction", async () => {
    const response = await POST(
      request({
        expectedTransactionId: transactionId,
        linkKey: "prize-link-1",
        transactionSafeJson: '{"signed":true}',
      }),
      { params: Promise.resolve({ publicId: "giveaway-1" }) },
    );

    expect(response.status).toBe(200);
    expect(verifyPreparedClaimMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedTransactionId: transactionId,
        winnerAddress: `kaspa:${"q".repeat(61)}`,
      }),
    );
    expect(mockPrisma.giveaway.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        prizeClaimTransactionId: transactionId,
        prizeClaimTransactionSafeJson: '{"signed":true}',
      }),
      where: { id: "giveaway-db-1" },
    });
  });

  it("rejects private recovery material instead of silently accepting it", async () => {
    const response = await POST(
      request({
        claimCode: "must-not-reach-the-server",
        expectedTransactionId: transactionId,
        linkKey: "prize-link-1",
        transactionSafeJson: '{"signed":true}',
      }),
      { params: Promise.resolve({ publicId: "giveaway-1" }) },
    );

    expect(response.status).toBe(400);
    expect(verifyPreparedClaimMock).not.toHaveBeenCalled();
    expect(mockPrisma.giveaway.update).not.toHaveBeenCalled();
  });

  it("refuses preparation after the winner claim window expires", async () => {
    const expired = {
      ...giveaway(),
      winnerClaimExpiresAt: new Date(Date.now() - 1),
    };
    mockPrisma.giveaway.findFirst.mockResolvedValue(expired);
    reconcileGiveawayPrizeMock.mockResolvedValue(expired);

    const response = await POST(
      request({
        expectedTransactionId: transactionId,
        linkKey: "prize-link-1",
        transactionSafeJson: '{"signed":true}',
      }),
      { params: Promise.resolve({ publicId: "giveaway-1" }) },
    );

    expect(response.status).toBe(409);
    expect(mockPrisma.giveaway.update).not.toHaveBeenCalled();
  });
});
