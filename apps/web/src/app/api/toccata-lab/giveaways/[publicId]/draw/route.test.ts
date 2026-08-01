import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockAudit, mockPrisma, mockReadCurrentBlueScore, mockReadEntropy, mockTx } = vi.hoisted(
  () => {
    const tx = {
      giveaway: { findUnique: vi.fn(), updateMany: vi.fn() },
      giveawayEntry: { findMany: vi.fn() },
    };
    return {
      mockAudit: vi.fn(),
      mockPrisma: {
        $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
        giveaway: { findUnique: vi.fn() },
      },
      mockReadCurrentBlueScore: vi.fn(),
      mockReadEntropy: vi.fn(),
      mockTx: tx,
    };
  },
);

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
vi.mock("@/lib/giveaway-chain-entropy", () => ({
  GIVEAWAY_ENTROPY_FUTURE_BLUE_SCORE_OFFSET: 100n,
  readConfirmedGiveawayChainEntropy: mockReadEntropy,
  readCurrentMainnetVirtualBlueScore: mockReadCurrentBlueScore,
}));

import { POST } from "./route";
import { freezeGiveawayEntries } from "@/lib/giveaway-lab";

const ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const SEED = "12".repeat(32);
const COMMITMENT = createHash("sha256")
  .update(`kaspa-links-giveaway-seed-v1\n${SEED}`)
  .digest("hex");

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
    drawCommitment: COMMITMENT,
    drawDigest: null,
    drawProtocolVersion: 2,
    drawSeedHex: SEED,
    entriesFrozenAt: null,
    entriesRoot: null,
    entryCountAtDraw: null,
    entropyBlockBlueScore: null,
    entropyBlockHash: null,
    entropyTargetBlueScore: null,
    id: "giveaway-db-1",
    openedAt: new Date(closesAt.getTime() - 60_000),
    publicId: "giveaway-1",
    status: "OPEN",
    winnerAddress: null,
    winnerClaimExpiresAt: null,
    winnerClaimWindowSeconds: 3_600,
    winnerIndex: null,
  };
}

describe("POST /api/toccata-lab/giveaways/[publicId]/draw", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    mockTx.giveaway.updateMany.mockResolvedValue({ count: 1 });
    mockReadCurrentBlueScore.mockResolvedValue(500_000_000n);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("does not allow a draw before entries close", async () => {
    mockPrisma.giveaway.findUnique.mockResolvedValue(giveaway(new Date(Date.now() + 60_000)));

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(409);
    expect(mockTx.giveawayEntry.findMany).not.toHaveBeenCalled();
  });

  it("does not draw an unfunded prize giveaway", async () => {
    mockPrisma.giveaway.findUnique.mockResolvedValue({
      ...giveaway(new Date(Date.now() - 60_000)),
      openedAt: null,
    });

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(409);
    expect(mockTx.giveawayEntry.findMany).not.toHaveBeenCalled();
  });

  it("freezes the participant root before the future entropy block exists", async () => {
    const record = giveaway(new Date(Date.now() - 60_000));
    mockPrisma.giveaway.findUnique.mockResolvedValue(record);
    mockTx.giveaway.findUnique.mockResolvedValue(record);
    mockTx.giveawayEntry.findMany.mockResolvedValue([{ address: ADDRESS, id: "entry-1" }]);

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(202);
    expect(mockTx.giveaway.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entriesFrozenAt: expect.any(Date),
        entriesRoot: expect.stringMatching(/^[0-9a-f]{64}$/),
        entryCountAtDraw: 1,
        entropyTargetBlueScore: 500_000_100n,
        status: "OPEN",
      }),
      where: { entriesFrozenAt: null, id: "giveaway-db-1", status: "OPEN" },
    });
    expect(mockReadEntropy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      giveaway: {
        drawProtocol: {
          entropyTargetBlueScore: "500000100",
          entriesRoot: expect.stringMatching(/^[0-9a-f]{64}$/),
          version: 2,
        },
        status: "CLOSED",
      },
    });
  });

  it("draws exactly once from the frozen root and confirmed chain block", async () => {
    const entries = [{ address: ADDRESS, id: "entry-1" }];
    const record = {
      ...giveaway(new Date(Date.now() - 60_000)),
      entriesFrozenAt: new Date(Date.now() - 30_000),
      entriesRoot: freezeGiveawayEntries(entries).entriesRoot,
      entryCountAtDraw: 1,
      entropyTargetBlueScore: 500_000_100n,
    };
    mockPrisma.giveaway.findUnique.mockResolvedValue(record);
    mockTx.giveaway.findUnique.mockResolvedValue(record);
    mockTx.giveawayEntry.findMany.mockResolvedValue(entries);
    mockReadEntropy.mockResolvedValue({
      blockBlueScore: 500_000_101n,
      blockHash: "cd".repeat(32),
      currentBlueScore: 500_000_250n,
      ready: true,
    });

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(200);
    expect(mockTx.giveaway.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entropyBlockBlueScore: 500_000_101n,
        entropyBlockHash: "cd".repeat(32),
        status: "DRAWN",
        winnerAddress: ADDRESS,
        winnerIndex: 0,
      }),
      where: {
        entriesRoot: record.entriesRoot,
        id: "giveaway-db-1",
        status: "OPEN",
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      giveaway: {
        drawProtocol: {
          entropyBlockHash: "cd".repeat(32),
          version: 2,
        },
        status: "DRAWN",
        winnerAddress: ADDRESS,
      },
    });
  });
});
