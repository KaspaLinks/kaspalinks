import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, resolveClaimableOnChainMock } = vi.hoisted(() => ({
  mockPrisma: {
    claimableLink: { update: vi.fn() },
    giveaway: { updateMany: vi.fn() },
  },
  resolveClaimableOnChainMock: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  GiveawayStatus: { OPEN: "OPEN" },
  prisma: mockPrisma,
}));
vi.mock("./claimable-onchain", () => ({
  resolveClaimableOnChain: resolveClaimableOnChainMock,
}));

import { reconcileGiveawayPrize, resetGiveawayPrizeRefreshForTests } from "./giveaway-prize";

function pendingGiveaway() {
  return {
    closesAt: new Date("2026-07-21T12:15:00.000Z"),
    createdAt: new Date("2026-07-21T12:00:00.000Z"),
    entryWindowSeconds: 900,
    id: "giveaway-1",
    openedAt: null,
    prizeLink: {
      amountSompi: 100_200_000n,
      claimTxId: null,
      createdAt: new Date("2026-07-21T11:59:00.000Z"),
      feeSompi: 200_000n,
      fundingAddress: `kaspa:${"q".repeat(61)}`,
      fundingOutputIndex: null,
      fundingTxId: null,
      id: "claimable-1",
      linkKey: "giveaway-prize-1",
      redeemScriptHex: "aa",
      refundLockTime: "123456",
      refundTxId: null,
      status: "awaiting_funding",
    },
    status: "OPEN",
  };
}

describe("giveaway prize reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGiveawayPrizeRefreshForTests();
    mockPrisma.giveaway.updateMany.mockResolvedValue({ count: 1 });
  });

  it("starts the full entry window only after exact funding is detected", async () => {
    resolveClaimableOnChainMock.mockResolvedValue({
      fundingOutputIndex: 2,
      fundingTxId: "a".repeat(64),
      status: "funded",
    });
    const now = new Date("2026-07-21T12:10:00.000Z");

    const result = await reconcileGiveawayPrize(pendingGiveaway(), now);

    expect(result.openedAt).toEqual(now);
    expect(result.closesAt).toEqual(new Date("2026-07-21T12:25:00.000Z"));
    expect(mockPrisma.giveaway.updateMany).toHaveBeenCalledWith({
      data: {
        closesAt: new Date("2026-07-21T12:25:00.000Z"),
        entryWindowSeconds: 900,
        openedAt: now,
      },
      where: { id: "giveaway-1", openedAt: null, status: "OPEN" },
    });
  });

  it("does not open or move the deadline without confirmed funding", async () => {
    resolveClaimableOnChainMock.mockResolvedValue(null);
    const input = pendingGiveaway();

    const result = await reconcileGiveawayPrize(input, new Date("2026-07-21T12:10:00.000Z"));

    expect(result.openedAt).toBeNull();
    expect(result.closesAt).toEqual(input.closesAt);
    expect(mockPrisma.giveaway.updateMany).not.toHaveBeenCalled();
  });

  it("does not open a giveaway when funding is detected after the funding window", async () => {
    resolveClaimableOnChainMock.mockResolvedValue({
      fundingOutputIndex: 2,
      fundingTxId: "b".repeat(64),
      status: "funded",
    });

    const result = await reconcileGiveawayPrize(
      pendingGiveaway(),
      new Date("2026-07-21T13:00:01.000Z"),
    );

    expect(result.openedAt).toBeNull();
    expect(mockPrisma.giveaway.updateMany).not.toHaveBeenCalled();
  });
});
