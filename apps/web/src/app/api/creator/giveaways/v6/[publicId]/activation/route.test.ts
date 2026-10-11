import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  broadcast: vi.fn(),
  build: vi.fn(),
  failure: vi.fn(),
  findFirst: vi.fn(),
  guard: vi.fn(),
  limit: vi.fn(),
  plan: vi.fn(),
  submitted: vi.fn(),
}));

vi.mock("@kaspa-actions/application", () => ({
  buildGiveawayV6ActivationTransaction: mocks.build,
  persistGiveawayV6ActivationFailure: mocks.failure,
  persistGiveawayV6ActivationPlan: mocks.plan,
  persistGiveawayV6ActivationSubmitted: mocks.submitted,
}));
vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  GiveawayV6BootstrapStatus: { AWAITING_FUNDING: "AWAITING_FUNDING", BOUND: "BOUND" },
  GiveawayV6Phase: { AWAITING_ACTIVATION: "AWAITING_ACTIVATION", OPEN: "OPEN" },
  prisma: { giveaway: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_MUTATION: "giveaway-mutation" },
}));
vi.mock("@/lib/toccata-lab", () => ({
  broadcastToccataGiveawayV6ActivationTransaction: mocks.broadcast,
}));

import { POST } from "./route";

const PUBLIC_ID = "cmi12345678901234567890123";
const TRANSACTION_ID = "ab".repeat(32);

function request() {
  return new Request(`https://kaspalinks.com/api/creator/giveaways/v6/${PUBLIC_ID}/activation`, {
    method: "POST",
  });
}

function context(publicId = PUBLIC_ID) {
  return { params: Promise.resolve({ publicId }) };
}

function giveaway(
  overrides: {
    activationSubmittedAt?: Date | null;
    activationTransactionId?: string | null;
    phase?: "AWAITING_ACTIVATION" | "OPEN";
    status?: "AWAITING_FUNDING" | "BOUND";
  } = {},
) {
  return {
    publicId: PUBLIC_ID,
    v6Bootstrap: {
      activationOutputs: [],
      activationSubmittedAt: overrides.activationSubmittedAt ?? null,
      activationTransactionId: overrides.activationTransactionId ?? null,
      compilerCommit: "compiler",
      config: {},
      covenantIdHex: "cd".repeat(32),
      expectedFundingSompi: 514_000_000n,
      familyTerms: {},
      fundingAcceptingBlockHash: "ef".repeat(32),
      fundingAddress: "kaspa:funding",
      fundingBlockDaaScore: 536_000_000n,
      fundingOutputIndex: 1,
      fundingScriptPublicKeyHex: "000051",
      fundingTransactionId: "12".repeat(32),
      giveawayId: "giveaway-id",
      id: "bootstrap-id",
      network: "MAINNET",
      prizeRedeemScriptHex: "51",
      prizeSourceSha256: "34".repeat(32),
      shardSourceSha256: "56".repeat(32),
      shardTemplateRedeemScriptHex: "51",
      status: overrides.status ?? "BOUND",
    },
    v6Projection: { phase: overrides.phase ?? "AWAITING_ACTIVATION" },
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
  mocks.findFirst.mockResolvedValue(giveaway());
  mocks.build.mockReturnValue({
    covenantIdHex: "cd".repeat(32),
    transactionId: TRANSACTION_ID,
    transactionSafeJson: '{"public":"transaction"}',
  });
  mocks.plan.mockResolvedValue(undefined);
  mocks.failure.mockResolvedValue(undefined);
  mocks.submitted.mockResolvedValue(undefined);
  mocks.broadcast.mockResolvedValue({
    submittedTransactionId: TRANSACTION_ID,
    transactionId: TRANSACTION_ID,
  });
  mocks.audit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Giveaway V6 activation route", () => {
  it("stays hidden while V6 creation is disabled", async () => {
    vi.stubEnv("GIVEAWAY_V6_CREATION_ENABLED", "false");

    const response = await POST(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.guard).not.toHaveBeenCalled();
  });

  it("requires confirmed funding before activation", async () => {
    mocks.findFirst.mockResolvedValue(giveaway({ status: "AWAITING_FUNDING" }));

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("persists the exact plan before broadcasting and records submission", async () => {
    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.plan.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.broadcast.mock.invocationCallOrder[0]!,
    );
    expect(mocks.broadcast).toHaveBeenCalledWith({
      expectedTransactionId: TRANSACTION_ID,
      transactionSafeJson: '{"public":"transaction"}',
    });
    expect(mocks.submitted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "bootstrap-id" }),
      TRANSACTION_ID,
      expect.any(Date),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event: "giveaway.v6_activation_submitted",
        metadata: expect.objectContaining({ transactionId: TRANSACTION_ID }),
      }),
    );
    expect(body).toEqual({
      activation: {
        chainStatus: "AWAITING_ACTIVATION",
        deliveryStatus: "SUBMITTED",
        transactionId: TRANSACTION_ID,
      },
      giveaway: { publicId: PUBLIC_ID, shareReady: false },
    });
  });

  it("returns a persisted submission without rebroadcasting", async () => {
    mocks.findFirst.mockResolvedValue(
      giveaway({
        activationSubmittedAt: new Date("2026-10-11T20:00:00.000Z"),
        activationTransactionId: TRANSACTION_ID,
      }),
    );

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.plan).toHaveBeenCalledOnce();
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.submitted).not.toHaveBeenCalled();
  });

  it("treats an already accepted retry as success", async () => {
    mocks.findFirst.mockResolvedValue(giveaway({ activationTransactionId: TRANSACTION_ID }));
    mocks.broadcast.mockRejectedValue(new Error("transaction already accepted"));

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.submitted).toHaveBeenCalledOnce();
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("stores only a bounded failure code when the relay is unavailable", async () => {
    mocks.broadcast.mockRejectedValue(new Error("private socket detail"));

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toEqual({
      code: "UPSTREAM_TIMEOUT",
      message: "Giveaway activation could not be submitted. Retrying is safe.",
    });
    expect(mocks.failure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "bootstrap-id" }),
      TRANSACTION_ID,
      expect.any(Date),
      "ACTIVATION_RELAY_UNAVAILABLE",
    );
    expect(mocks.failure.mock.calls.flat()).not.toContain("private socket detail");
  });

  it("returns a confirmed projection without touching the relay", async () => {
    mocks.findFirst.mockResolvedValue(
      giveaway({ activationTransactionId: TRANSACTION_ID, phase: "OPEN" }),
    );

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      activation: {
        chainStatus: "OPEN",
        deliveryStatus: "CONFIRMED",
        transactionId: TRANSACTION_ID,
      },
      giveaway: { publicId: PUBLIC_ID, shareReady: true },
    });
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
