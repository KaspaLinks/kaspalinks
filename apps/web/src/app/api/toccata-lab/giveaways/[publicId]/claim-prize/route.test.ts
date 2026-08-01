import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const {
  broadcastClaimMock,
  mockPrisma,
  reconcileGiveawayPrizeMock,
  verifyPreparedClaimMock,
  writeAuditLogMock,
} = vi.hoisted(() => ({
  broadcastClaimMock: vi.fn(),
  mockPrisma: {
    claimableLink: { updateMany: vi.fn() },
    giveaway: { findUnique: vi.fn() },
  },
  reconcileGiveawayPrizeMock: vi.fn(),
  verifyPreparedClaimMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { PUBLIC: "PUBLIC" },
  GiveawayStatus: { DRAWN: "DRAWN" },
  prisma: mockPrisma,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/giveaway-prize", () => ({
  reconcileGiveawayPrize: reconcileGiveawayPrizeMock,
}));
vi.mock("@/lib/giveaway-prize-claim", () => ({
  verifyPreparedGiveawayPrizeClaim: verifyPreparedClaimMock,
}));
vi.mock("@/lib/toccata-lab", () => ({
  broadcastToccataClaimableTransaction: broadcastClaimMock,
}));

import { POST } from "./route";

const transactionId = "cd".repeat(32);

function giveaway() {
  return {
    creatorId: "creator-1",
    prizeClaimTransactionId: transactionId,
    prizeClaimTransactionSafeJson: '{"signed":true}',
    prizeLink: {
      claimTxId: null as null | string,
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

function request() {
  return new Request("https://kaspalinks.com/api/toccata-lab/giveaways/giveaway-1/claim-prize", {
    headers: { "x-forwarded-for": "203.0.113.50" },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/giveaways/[publicId]/claim-prize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    mockPrisma.giveaway.findUnique.mockResolvedValue(giveaway());
    reconcileGiveawayPrizeMock.mockResolvedValue(giveaway());
    broadcastClaimMock.mockResolvedValue({ submittedTransactionId: transactionId });
    mockPrisma.claimableLink.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("relays the verified fixed winner payout and records it as claimed", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(200);
    expect(verifyPreparedClaimMock).toHaveBeenCalledOnce();
    expect(broadcastClaimMock).toHaveBeenCalledWith({
      expectedTransactionId: transactionId,
      linkKey: "prize-link-1",
      transactionSafeJson: '{"signed":true}',
    });
    expect(mockPrisma.claimableLink.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({ claimTxId: transactionId, status: "claimed" }),
      where: {
        id: "prize-db-1",
        status: { notIn: ["claimed", "refunded", "spent_unknown"] },
      },
    });
  });

  it("is idempotent after the prize was already claimed", async () => {
    const claimed = giveaway();
    claimed.prizeLink.claimTxId = transactionId;
    claimed.prizeLink.status = "claimed";
    mockPrisma.giveaway.findUnique.mockResolvedValue(claimed);
    reconcileGiveawayPrizeMock.mockResolvedValue(claimed);

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(200);
    expect(broadcastClaimMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      claimed: true,
      transactionId,
    });
  });

  it("never broadcasts after the winner claim window expires", async () => {
    const expired = {
      ...giveaway(),
      winnerClaimExpiresAt: new Date(Date.now() - 1),
    };
    mockPrisma.giveaway.findUnique.mockResolvedValue(expired);
    reconcileGiveawayPrizeMock.mockResolvedValue(expired);

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(409);
    expect(broadcastClaimMock).not.toHaveBeenCalled();
  });
});
