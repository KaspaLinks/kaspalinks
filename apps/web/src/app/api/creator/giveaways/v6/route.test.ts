import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  chain: vi.fn(),
  compile: vi.fn(),
  giveawayCreate: vi.fn(),
  guard: vi.fn(),
  limit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  GiveawayStatus: { OPEN: "OPEN" },
  GiveawayV6BootstrapStatus: { AWAITING_FUNDING: "AWAITING_FUNDING" },
  Network: { MAINNET: "MAINNET" },
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/mainnet-chain-position", () => ({
  readCurrentMainnetChainPosition: mocks.chain,
}));
vi.mock("@/lib/giveaway-v6-compiler", () => ({
  compileGiveawayV6Bootstrap: mocks.compile,
  GiveawayV6CompilerError: class GiveawayV6CompilerError extends Error {},
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_MUTATION: "giveaway-mutation" },
}));

import { POST } from "./route";

const fundingAddress =
  "kaspa:pr4khhd3dw35mpw6x8ussg63g62mu5hj9dnv9h6ujkm32v7uelzwkncj2d3uk";
const returnAddress =
  "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const bootstrap = {
  compilerCommit: "3ed973335b59269293564805cc2c58a14595ec03",
  config: {},
  expectedFundingSompi: 504_100_000n,
  familyTerms: {},
  fundingAddress,
  fundingScriptPublicKeyHex: "0000aa20" + "11".repeat(32) + "87",
  network: "MAINNET",
  prizeRedeemScriptHex: "51",
  prizeSourceSha256: "22".repeat(32),
  shardSourceSha256: "33".repeat(32),
  shardTemplateRedeemScriptHex: "51",
  status: "AWAITING_FUNDING",
};

function request(body: unknown) {
  return new Request("https://kaspalinks.com/api/creator/giveaways/v6", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function validBody() {
  return {
    amountKas: "1",
    description: "Mainnet community draw",
    durationSeconds: 3_600,
    returnAddress,
    title: "Community KAS",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
  vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
  vi.stubEnv("GIVEAWAY_V6_CREATION_ENABLED", "true");
  mocks.guard.mockResolvedValue({
    creator: { id: "creator-id", prizeCovenantEnabled: true },
    ipHash: "ip-hash",
    ok: true,
  });
  mocks.limit.mockReturnValue({ allowed: true });
  mocks.chain.mockResolvedValue({ daa: 536_000_000n, blueScore: 535_000_000n });
  mocks.compile.mockResolvedValue(bootstrap);
  mocks.giveawayCreate.mockResolvedValue({
    createdAt: new Date("2026-10-11T12:00:00.000Z"),
    publicId: "cmi12345678901234567890123",
  });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({ giveaway: { create: mocks.giveawayCreate } }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Giveaway V6 creator route", () => {
  it("hides the flow until the independent creation gate is enabled", async () => {
    vi.stubEnv("GIVEAWAY_V6_CREATION_ENABLED", "false");

    const response = await POST(request(validBody()));

    expect(response.status).toBe(404);
    expect(mocks.guard).not.toHaveBeenCalled();
  });

  it("requires the per-creator covenant canary", async () => {
    mocks.guard.mockResolvedValue({
      creator: { id: "creator-id", prizeCovenantEnabled: false },
      ipHash: "ip-hash",
      ok: true,
    });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(404);
    expect(mocks.compile).not.toHaveBeenCalled();
  });

  it("persists the reviewed bootstrap atomically before returning the Kaspium intent", async () => {
    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.guard).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ $transaction: mocks.transaction }),
      {
      allowTelegramMiniApp: true,
      allowTelegramOnly: true,
      },
    );
    expect(mocks.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        economics: expect.objectContaining({ prizeValueSompi: 100_000_000n }),
        network: "MAINNET",
      }),
    );
    const createData = mocks.giveawayCreate.mock.calls[0][0].data;
    expect(createData).toMatchObject({
      amountSompi: 100_000_000n,
      creatorId: "creator-id",
      drawProtocolVersion: 6,
      entryWindowSeconds: 3_600,
      openedAt: null,
      status: "OPEN",
      v6Bootstrap: { create: bootstrap },
    });
    expect(Object.keys(createData).join(" ")).not.toMatch(/private|recovery|seedPhrase/iu);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ giveaway: expect.anything() }),
      expect.objectContaining({ event: "giveaway.v6_created" }),
    );
    expect(body).toMatchObject({
      giveaway: {
        participantCap: 4_000,
        publicUrl: "/giveaways/cmi12345678901234567890123",
        shareReady: false,
        status: "AWAITING_FUNDING",
      },
      funding: {
        address: fundingAddress,
        amountKas: "5.041",
        amountSompi: "504100000",
        breakdown: {
          activationFeeSompi: "100000",
          executionReserveSompi: "404000000",
          prizeSompi: "100000000",
        },
        network: "mainnet",
        unusedReserveReturnAddress: returnAddress,
      },
      review: { shardCount: 4 },
    });
    expect(body.funding.paymentUri).toContain(`${fundingAddress}?amount=5.041`);
  });

  it("rejects unrecognized recovery input before chain access or compilation", async () => {
    const response = await POST(request({ ...validBody(), privateKey: "never-store" }));

    expect(response.status).toBe(400);
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not persist or return a funding intent when compilation fails", async () => {
    mocks.compile.mockRejectedValue(new Error("compiler unavailable"));

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
