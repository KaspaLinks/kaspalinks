import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockAudit, mockPrisma, mockTx } = vi.hoisted(() => {
  const tx = {
    giveaway: { findUnique: vi.fn(), updateMany: vi.fn() },
    giveawayEntry: { findMany: vi.fn() },
  };
  return {
    mockAudit: vi.fn(),
    mockPrisma: { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) },
    mockTx: tx,
  };
});

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { PUBLIC: "PUBLIC" },
  GiveawayStatus: {
    CANCELLED: "CANCELLED",
    DRAWN: "DRAWN",
    NO_ENTRIES: "NO_ENTRIES",
    OPEN: "OPEN",
  },
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  prisma: mockPrisma,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mockAudit }));

import { POST } from "./route";

const ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

function request() {
  return new Request("https://kaspalinks.com/api/toccata-lab/giveaways/giveaway-1/draw", {
    headers: { "x-forwarded-for": "203.0.113.44" },
    method: "POST",
  });
}

function giveaway(closesAt: Date) {
  return {
    closesAt,
    creatorId: "creator-1",
    drawCommitment: "a".repeat(64),
    drawSeedHex: "12".repeat(32),
    id: "giveaway-db-1",
    publicId: "giveaway-1",
    status: "OPEN",
  };
}

describe("POST /api/toccata-lab/giveaways/[publicId]/draw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    mockTx.giveaway.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("does not allow the creator to draw before entries close", async () => {
    mockTx.giveaway.findUnique.mockResolvedValue(giveaway(new Date(Date.now() + 60_000)));

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(409);
    expect(mockTx.giveawayEntry.findMany).not.toHaveBeenCalled();
  });

  it("persists exactly one deterministic winner after the deadline", async () => {
    mockTx.giveaway.findUnique.mockResolvedValue(giveaway(new Date(Date.now() - 60_000)));
    mockTx.giveawayEntry.findMany.mockResolvedValue([{ address: ADDRESS, id: "entry-1" }]);

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(200);
    expect(mockTx.giveaway.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryCountAtDraw: 1,
        status: "DRAWN",
        winnerAddress: ADDRESS,
        winnerEntryId: "entry-1",
        winnerIndex: 0,
      }),
      where: { id: "giveaway-db-1", status: "OPEN" },
    });
    await expect(response.json()).resolves.toMatchObject({
      giveaway: { status: "DRAWN", winnerAddress: ADDRESS },
    });
  });
});
