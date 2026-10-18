import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  chain: vi.fn(),
  compile: vi.fn(),
  giveawayCreate: vi.fn(),
  giveawayFindMany: vi.fn(),
  slotCreate: vi.fn(),
  slotFindUnique: vi.fn(),
  guard: vi.fn(),
  limit: vi.fn(),
  transaction: vi.fn(),
  unfundedCount: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  GiveawayStatus: { OPEN: "OPEN" },
  GiveawayV6BootstrapStatus: { AWAITING_FUNDING: "AWAITING_FUNDING", BOUND: "BOUND" },
  GiveawayV6Phase: { AWAITING_ACTIVATION: "AWAITING_ACTIVATION" },
  Network: { MAINNET: "MAINNET" },
  prisma: {
    $transaction: mocks.transaction,
    giveaway: { findMany: mocks.giveawayFindMany },
    giveawayV6Bootstrap: { count: mocks.unfundedCount },
    giveawayDrawSlot: { create: mocks.slotCreate, findUnique: mocks.slotFindUnique },
  },
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

import { GET, POST } from "./route";

const fundingAddress = "kaspa:pr4khhd3dw35mpw6x8ussg63g62mu5hj9dnv9h6ujkm32v7uelzwkncj2d3uk";
const returnAddress = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const bootstrap = {
  compilerCommit: "3ed973335b59269293564805cc2c58a14595ec03",
  config: {},
  expectedFundingSompi: 515_000_000n,
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
    participantCap: 32,
    returnAddress,
    slotStartsAt: "2026-10-15T12:00:00.000Z",
    title: "Community KAS",
  };
}

const now = new Date("2026-10-15T11:00:00.000Z");

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
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
  mocks.giveawayFindMany.mockResolvedValue([]);
  mocks.unfundedCount.mockResolvedValue(0);
  mocks.slotFindUnique.mockResolvedValue(null);
  mocks.slotCreate.mockImplementation(async ({ data }) => data);
  mocks.giveawayCreate.mockResolvedValue({
    createdAt: new Date("2026-10-11T12:00:00.000Z"),
    publicId: "cmi12345678901234567890123",
  });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({ giveaway: { create: mocks.giveawayCreate } }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Giveaway V6 creator route", () => {
  it("lists only creator-owned V6 setup state with JSON-safe amounts", async () => {
    mocks.giveawayFindMany.mockResolvedValue([
      {
        amountSompi: 50_000_000n,
        closesAt: new Date("2026-10-12T13:00:00.000Z"),
        createdAt: new Date("2026-10-12T12:00:00.000Z"),
        description: null,
        publicId: "cmi12345678901234567890123",
        title: "Weekend KAS",
        v6Bootstrap: {
          activationSubmittedAt: new Date("2026-10-12T12:05:00.000Z"),
          activationTransactionId: "aa".repeat(32),
          config: {
            closesAtDaa: "536036000",
            entropyTargetBlueScore: "535036600",
            giveawayIdHex: "42".repeat(32),
            maxEntriesPerShard: 8,
            returnAtDaa: "536900000",
            returnScriptPublicKeyHex: "0000aa20" + "44".repeat(32) + "87",
            shardCount: 4,
            treeDepth: 10,
          },
          expectedFundingSompi: 464_000_000n,
          fundingAddress,
          status: "BOUND",
        },
        v6Projection: {
          frozenEntryCount: null,
          observedRegistrationCount: 7,
          phase: "OPEN",
          terminalTransactionId: null,
          winnerScriptPublicKeyHex: null,
        },
      },
    ]);

    const response = await GET(
      new Request("https://kaspalinks.com/api/creator/giveaways/v6", { method: "GET" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.giveawayFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        where: { creatorId: "creator-id", drawProtocolVersion: 6 },
      }),
    );
    expect(body.giveaways[0]).toMatchObject({
      amountKas: "0.5",
      funding: {
        amountKas: "4.64",
        amountSompi: "464000000",
        status: "BOUND",
      },
      participantCap: 32,
      phase: "OPEN",
      registrationCount: 7,
      shareReady: true,
    });
    expect(body.giveaways[0].activation.activateUrl).toBe(
      "/api/creator/giveaways/v6/cmi12345678901234567890123/activation",
    );
  });

  it("returns the shared JSON error shape when the creator list is unavailable", async () => {
    mocks.giveawayFindMany.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(
      new Request("https://kaspalinks.com/api/creator/giveaways/v6", { method: "GET" }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "SERVER_ERROR", message: "Giveaways could not be loaded." },
    });
  });

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

  it("opens creation to every creator with the mainnet-proven size only", async () => {
    vi.stubEnv("GIVEAWAY_V6_ALL_CREATORS", "true");
    mocks.guard.mockResolvedValue({
      creator: { id: "creator-id", prizeCovenantEnabled: false },
      ipHash: "ip-hash",
      ok: true,
    });

    const tooLarge = await POST(request(validBody()));
    expect(tooLarge.status).toBe(400);
    expect((await tooLarge.json()).error.message).toContain("32 participants");
    expect(mocks.compile).not.toHaveBeenCalled();

    // Past the access gate; the stub contracts then meet the fee check, not this rule.
    const proven = await POST(request({ ...validBody(), participantCap: 8 }));
    expect(proven.status).not.toBe(400);
    expect(mocks.compile).toHaveBeenCalledTimes(1);

    const list = await GET(new Request("https://kaspalinks.com/api/creator/giveaways/v6"));
    expect((await list.json()).participantCaps).toEqual([8]);
  });

  it("keeps every size for allowlisted creators", async () => {
    const list = await GET(new Request("https://kaspalinks.com/api/creator/giveaways/v6"));
    expect((await list.json()).participantCaps).toEqual([8, 16, 32]);
  });

  it("stops a creator who already holds three unfunded Giveaways", async () => {
    mocks.unfundedCount.mockResolvedValue(3);

    const response = await POST(request(validBody()));

    expect(response.status).toBe(429);
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(mocks.unfundedCount).toHaveBeenCalledWith({
      where: {
        giveaway: { closesAt: { gt: now }, creatorId: "creator-id" },
        status: "AWAITING_FUNDING",
      },
    });
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
      closesAt: new Date("2026-10-15T12:00:00.000Z"),
      entropyTargetBlueScore: 535_036_600n,
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
    expect(mocks.slotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        anchorDaa: 536_000_000n,
        closesAtDaa: 536_036_000n,
        network: "MAINNET",
        startsAt: new Date("2026-10-15T12:00:00.000Z"),
      }),
    });
    expect(body).toMatchObject({
      giveaway: {
        closesAt: "2026-10-15T12:00:00.000Z",
        participantCap: 32,
        publicUrl: "/giveaways/cmi12345678901234567890123",
        shareReady: false,
        status: "AWAITING_FUNDING",
      },
      funding: {
        address: fundingAddress,
        amountKas: "5.15",
        amountSompi: "515000000",
        breakdown: {
          activationFeeSompi: "11000000",
          executionReserveSompi: "404000000",
          maximumEntryFeesSompi: "320000000",
          maximumNetworkCostSompi: "384000000",
          minimumReturnSompi: "31000000",
          prizeSompi: "100000000",
          settlementFeesSompi: "53000000",
        },
        network: "mainnet",
        unusedReserveReturnAddress: returnAddress,
      },
      review: {
        closesAtDaa: "536036000",
        entropyTargetBlueScore: "535036600",
        returnAtDaa: "536900000",
        shardCount: 4,
      },
    });
    expect(body.funding.paymentUri).toContain(`${fundingAddress}?amount=5.15`);
  });

  it("commits the terms already fixed for the slot instead of its own projection", async () => {
    // Blocks ran ahead since the first Giveaway of this slot: a fresh
    // projection would give another entropy target and need its own proof.
    mocks.chain.mockResolvedValue({ daa: 536_000_900n, blueScore: 535_000_900n });
    mocks.slotFindUnique.mockResolvedValue({
      closesAtDaa: 536_036_000n,
      entropyTargetBlueScore: 535_036_600n,
      returnAtDaa: 536_900_000n,
    });

    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.slotFindUnique).toHaveBeenCalledWith({
      where: {
        network_startsAt: {
          network: "MAINNET",
          startsAt: new Date("2026-10-15T12:00:00.000Z"),
        },
      },
    });
    expect(mocks.slotCreate).not.toHaveBeenCalled();
    expect(mocks.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          closesAtDaa: 536_036_000n,
          entropyTargetBlueScore: 535_036_600n,
          returnAtDaa: 536_900_000n,
        }),
      }),
    );
    expect(body.review.entropyTargetBlueScore).toBe("535036600");
  });

  it("reads the winning terms when another creation fixed the slot first", async () => {
    mocks.slotFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      closesAtDaa: 536_035_000n,
      entropyTargetBlueScore: 535_035_600n,
      returnAtDaa: 536_899_000n,
    });
    mocks.slotCreate.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));

    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.review).toMatchObject({
      closesAtDaa: "536035000",
      entropyTargetBlueScore: "535035600",
    });
  });

  it.each([
    ["2026-10-15T13:00:00.000Z", "only at 00:00, 06:00, 12:00 or 18:00 UTC"],
    ["2026-10-15T06:00:00.000Z", "closed 30 minutes before it"],
    ["2026-10-16T18:00:00.000Z", "at most 24 hours ahead"],
  ])("refuses %s before reading the chain", async (slotStartsAt, message) => {
    const response = await POST(request({ ...validBody(), slotStartsAt }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain(message);
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.slotCreate).not.toHaveBeenCalled();
  });

  it("refuses a slot the chain has already brought within the cutoff", async () => {
    vi.setSystemTime(new Date("2026-10-15T11:29:00.000Z"));
    mocks.slotFindUnique.mockResolvedValue({
      closesAtDaa: 536_010_000n,
      entropyTargetBlueScore: 535_010_600n,
      returnAtDaa: 536_874_000n,
    });

    const response = await POST(
      request({ ...validBody(), slotStartsAt: "2026-10-15T12:00:00.000Z" }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("On the chain");
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns the smaller reviewed funding intent for an eight-person giveaway", async () => {
    mocks.compile.mockResolvedValue({
      ...bootstrap,
      expectedFundingSompi: 223_000_000n,
    });

    const response = await POST(request({ ...validBody(), amountKas: "0.5", participantCap: 8 }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.compile).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ shardCount: 1 }),
        economics: expect.objectContaining({ shardValueSompi: 164_000_000n }),
      }),
    );
    expect(body).toMatchObject({
      giveaway: { participantCap: 8 },
      funding: {
        amountKas: "2.23",
        breakdown: {
          maximumNetworkCostSompi: "127000000",
          minimumReturnSompi: "46000000",
        },
      },
      review: { shardCount: 1 },
    });
    expect(body.funding.paymentUri).toContain(`${fundingAddress}?amount=2.23`);
  });

  it("rejects unrecognized recovery input before chain access or compilation", async () => {
    const response = await POST(request({ ...validBody(), privateKey: "never-store" }));

    expect(response.status).toBe(400);
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(mocks.compile).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuses a Giveaway whose committed fees would not relay", async () => {
    // A prize script this large would need far more than the committed fees.
    mocks.compile.mockResolvedValue({ ...bootstrap, prizeRedeemScriptHex: "51".repeat(200_000) });

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toContain("network fees");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not persist or return a funding intent when compilation fails", async () => {
    mocks.compile.mockRejectedValue(new Error("compiler unavailable"));

    const response = await POST(request(validBody()));

    expect(response.status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
