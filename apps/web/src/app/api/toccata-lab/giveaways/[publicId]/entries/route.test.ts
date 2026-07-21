import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma, mockTx, verifyGiveawayTurnstileMock } = vi.hoisted(() => {
  const tx = {
    giveaway: { findUnique: vi.fn() },
    giveawayEntry: { count: vi.fn(), create: vi.fn() },
  };
  return {
    mockPrisma: { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) },
    mockTx: tx,
    verifyGiveawayTurnstileMock: vi.fn(),
  };
});

vi.mock("@kaspa-actions/db", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
  prisma: mockPrisma,
}));

vi.mock("@/lib/turnstile", () => ({
  verifyGiveawayTurnstile: verifyGiveawayTurnstileMock,
}));

import { POST } from "./route";

const ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

function request(address = ADDRESS, turnstileToken: string | undefined = undefined) {
  return new Request("https://kaspalinks.com/api/toccata-lab/giveaways/giveaway-1/entries", {
    body: JSON.stringify({ address, turnstileToken }),
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
    verifyGiveawayTurnstileMock.mockResolvedValue({ ok: true });
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

  it("requires successful server-side bot verification before writing an entry", async () => {
    verifyGiveawayTurnstileMock.mockResolvedValue({ kind: "invalid", ok: false });

    const response = await POST(request(ADDRESS, "invalid-token"), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(403);
    expect(verifyGiveawayTurnstileMock).toHaveBeenCalledWith({
      remoteIp: "203.0.113.42",
      token: "invalid-token",
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BOT_VERIFICATION_FAILED" },
    });
  });

  it("returns a temporary error when Turnstile cannot be reached", async () => {
    verifyGiveawayTurnstileMock.mockResolvedValue({ kind: "unavailable", ok: false });

    const response = await POST(request(ADDRESS, "token"), {
      params: Promise.resolve({ publicId: "giveaway-1" }),
    });

    expect(response.status).toBe(503);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "BOT_VERIFICATION_UNAVAILABLE" },
    });
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
