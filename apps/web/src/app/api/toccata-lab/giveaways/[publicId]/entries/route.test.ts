import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma, mockTx } = vi.hoisted(() => {
  const tx = {
    giveaway: { findUnique: vi.fn() },
    giveawayEntry: { count: vi.fn(), create: vi.fn() },
  };
  return {
    mockPrisma: { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) },
    mockTx: tx,
  };
});

vi.mock("@kaspa-actions/db", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  prisma: mockPrisma,
}));

import { POST } from "./route";

const ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

function request(address = ADDRESS) {
  return new Request("https://kaspalinks.com/api/toccata-lab/giveaways/giveaway-1/entries", {
    body: JSON.stringify({ address }),
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.42" },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/giveaways/[publicId]/entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    mockTx.giveaway.findUnique.mockResolvedValue({
      closesAt: new Date(Date.now() + 60_000),
      id: "giveaway-db-1",
      status: "OPEN",
    });
    mockTx.giveawayEntry.create.mockResolvedValue({ id: "entry-1" });
    mockTx.giveawayEntry.count.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it("stores one normalized mainnet address and returns a public receipt hash", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(201);
    expect(mockTx.giveawayEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ address: ADDRESS, giveawayId: "giveaway-db-1" }),
    });
    await expect(response.json()).resolves.toMatchObject({
      entry: { address: ADDRESS, entryHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      entryCount: 1,
    });
  });

  it("refuses entries after the fixed deadline", async () => {
    mockTx.giveaway.findUnique.mockResolvedValue({
      closesAt: new Date(Date.now() - 1),
      id: "giveaway-db-1",
      status: "OPEN",
    });

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(409);
    expect(mockTx.giveawayEntry.create).not.toHaveBeenCalled();
  });

  it("turns a database uniqueness conflict into a clear duplicate-entry response", async () => {
    mockTx.giveawayEntry.create.mockRejectedValue({
      code: "P2002",
      meta: { target: ["giveawayId", "address"] },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "This address is already entered." },
    });
  });
});
