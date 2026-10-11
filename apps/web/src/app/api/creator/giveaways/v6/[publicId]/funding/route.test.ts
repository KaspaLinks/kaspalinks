import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class BootstrapError extends Error {
    constructor(
      readonly code: "INVALID_BOOTSTRAP" | "INVALID_FUNDING" | "STALE_BOOTSTRAP",
      message: string,
    ) {
      super(message);
    }
  }
  return {
    audit: vi.fn(),
    BootstrapError,
    findFirst: vi.fn(),
    funding: vi.fn(),
    guard: vi.fn(),
    limit: vi.fn(),
    persist: vi.fn(),
    prepare: vi.fn(),
  };
});

vi.mock("@kaspa-actions/application", () => ({
  GiveawayV6BootstrapError: mocks.BootstrapError,
  persistGiveawayV6BootstrapBinding: mocks.persist,
  prepareGiveawayV6BootstrapBinding: mocks.prepare,
}));
vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  GiveawayV6BootstrapStatus: { AWAITING_FUNDING: "AWAITING_FUNDING", BOUND: "BOUND" },
  GiveawayV6Phase: { AWAITING_ACTIVATION: "AWAITING_ACTIVATION", OPEN: "OPEN" },
  prisma: { giveaway: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/giveaway-v6-funding", () => ({
  readGiveawayV6ConfirmedFunding: mocks.funding,
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_MUTATION: "giveaway-mutation" },
}));

import { POST } from "./route";

const PUBLIC_ID = "cmi12345678901234567890123";
const TX_ID = "22".repeat(32);
const BLOCK_HASH = "33".repeat(32);
const COVENANT_ID = "44".repeat(32);
const FUNDING_ADDRESS = "kaspa:pr4khhd3dw35mpw6x8ussg63g62mu5hj9dnv9h6ujkm32v7uelzwkncj2d3uk";
const SCRIPT = `0000aa20${"11".repeat(32)}87`;

function request() {
  return new Request(`https://kaspalinks.com/api/creator/giveaways/v6/${PUBLIC_ID}/funding`, {
    method: "POST",
  });
}

function context(publicId = PUBLIC_ID) {
  return { params: Promise.resolve({ publicId }) };
}

function awaitingGiveaway() {
  return {
    publicId: PUBLIC_ID,
    v6Bootstrap: {
      compilerCommit: "compiler-commit",
      config: {},
      covenantIdHex: null,
      expectedFundingSompi: 504_100_000n,
      familyTerms: {},
      fundingAcceptingBlockHash: null,
      fundingAddress: FUNDING_ADDRESS,
      fundingBlockDaaScore: null,
      fundingOutputIndex: null,
      fundingScriptPublicKeyHex: SCRIPT,
      fundingTransactionId: null,
      giveawayId: "giveaway-id",
      id: "bootstrap-id",
      network: "MAINNET",
      prizeRedeemScriptHex: "51",
      prizeSourceSha256: "55".repeat(32),
      shardSourceSha256: "66".repeat(32),
      shardTemplateRedeemScriptHex: "51",
      status: "AWAITING_FUNDING",
    },
    v6Projection: null,
  };
}

function boundGiveaway(phase = "AWAITING_ACTIVATION") {
  const giveaway = awaitingGiveaway();
  return {
    ...giveaway,
    v6Bootstrap: {
      ...giveaway.v6Bootstrap,
      covenantIdHex: COVENANT_ID,
      fundingAcceptingBlockHash: BLOCK_HASH,
      fundingBlockDaaScore: 536_000_000n,
      fundingOutputIndex: 1,
      fundingTransactionId: TX_ID,
      status: "BOUND",
    },
    v6Projection: { phase },
  };
}

const confirmedFunding = {
  acceptingBlockHash: BLOCK_HASH,
  amountSompi: 504_100_000n,
  blockDaaScore: 536_000_000n,
  covenantIdHex: null,
  outputIndex: 1,
  scriptPublicKeyHex: SCRIPT,
  transactionId: TX_ID,
};

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
  mocks.findFirst.mockResolvedValue(awaitingGiveaway());
  mocks.funding.mockResolvedValue({ funding: confirmedFunding, status: "confirmed" });
  mocks.prepare.mockReturnValue({
    activationOutputs: [],
    bootstrapUpdate: {},
    family: { covenantIdHex: COVENANT_ID },
    projectionCreate: {},
  });
  mocks.persist.mockResolvedValue(undefined);
  mocks.audit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Giveaway V6 creator funding route", () => {
  it("stays hidden while V6 creation is disabled", async () => {
    vi.stubEnv("GIVEAWAY_V6_CREATION_ENABLED", "false");

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.guard).not.toHaveBeenCalled();
  });

  it("loads only a V6 giveaway owned by the authenticated creator", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { creatorId: "creator-id", drawProtocolVersion: 6, publicId: PUBLIC_ID },
      }),
    );
    expect(mocks.funding).not.toHaveBeenCalled();
  });

  it("keeps the creator waiting when no exact confirmed funding exists", async () => {
    mocks.funding.mockResolvedValue({ status: "pending" });

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      activation: { status: "AWAITING_ACTIVATION" },
      funding: {
        address: FUNDING_ADDRESS,
        amountSompi: "504100000",
        confirmationPending: true,
        status: "AWAITING_FUNDING",
      },
      giveaway: { publicId: PUBLIC_ID, shareReady: false },
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("binds exact funding and records a public audit event", async () => {
    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.funding).toHaveBeenCalledWith({
      expectedFundingSompi: 504_100_000n,
      fundingAddress: FUNDING_ADDRESS,
      fundingScriptPublicKeyHex: SCRIPT,
    });
    expect(mocks.prepare).toHaveBeenCalledWith({
      funding: confirmedFunding,
      record: expect.objectContaining({ id: "bootstrap-id" }),
    });
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.objectContaining({ giveaway: expect.anything() }),
      expect.objectContaining({ id: "bootstrap-id" }),
      expect.objectContaining({ family: { covenantIdHex: COVENANT_ID } }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: "giveaway.v6_funding_bound",
        metadata: expect.objectContaining({ fundingTransactionId: TX_ID, publicId: PUBLIC_ID }),
      }),
    );
    expect(body).toEqual({
      activation: { covenantIdHex: COVENANT_ID, status: "AWAITING_ACTIVATION" },
      funding: {
        acceptingBlockHash: BLOCK_HASH,
        blockDaaScore: "536000000",
        outputIndex: 1,
        status: "BOUND",
        transactionId: TX_ID,
      },
      giveaway: { publicId: PUBLIC_ID, shareReady: false },
    });
  });

  it("returns an existing atomic binding idempotently", async () => {
    mocks.findFirst.mockResolvedValue(boundGiveaway("OPEN"));

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.activation).toEqual({ covenantIdHex: COVENANT_ID, status: "OPEN" });
    expect(body.giveaway.shareReady).toBe(true);
    expect(mocks.funding).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("fails closed when Mainnet lookup is unavailable or inconsistent", async () => {
    mocks.funding.mockRejectedValue(new Error("bad upstream"));

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("UPSTREAM_TIMEOUT");
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
});
