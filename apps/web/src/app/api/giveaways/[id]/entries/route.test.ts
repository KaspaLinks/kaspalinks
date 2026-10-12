import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  audit: vi.fn(),
  broadcast: vi.fn(),
  buildV6: vi.fn(),
  chain: vi.fn(),
  findUnique: vi.fn(),
  ready: vi.fn(),
  register: vi.fn(),
  restore: vi.fn(),
  script: vi.fn(),
  verify: vi.fn(),
  normalize: vi.fn(),
  limit: vi.fn(),
  v6Enabled: vi.fn(),
}));
vi.mock("@kaspa-actions/application", () => ({
  buildGiveawayV6RegistrationTransaction: m.buildV6,
  restoreGiveawayV6Projection: m.restore,
}));
vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { PUBLIC: "PUBLIC" },
  GiveawayV6Phase: { OPEN: "OPEN" },
  prisma: { auditLog: { create: vi.fn() }, giveaway: { findUnique: m.findUnique } },
}));
vi.mock("@kaspa-actions/kaspa", () => ({
  buildKaspaAddressScriptPublicKeyHex: m.script,
  stringifyWithBigInts: (value: unknown) => JSON.stringify(value),
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: m.audit }));
vi.mock("@/lib/giveaway-v6-creation", () => ({
  isGiveawayV6CreationEnabled: m.v6Enabled,
}));
vi.mock("@/lib/mainnet-chain-position", () => ({ readCurrentMainnetChainPosition: m.chain }));
vi.mock("@/lib/toccata-lab", () => ({
  broadcastToccataGiveawayV6RegistrationTransaction: m.broadcast,
}));
vi.mock("@/lib/public-covenant", () => ({
  publicCovenantVerificationReady: m.ready,
  registerPublicCovenant: m.register,
}));
vi.mock("@/lib/turnstile", () => ({ verifyGiveawayTurnstile: m.verify }));
vi.mock("@/lib/giveaway-lab", () => ({ normalizeGiveawayAddress: m.normalize }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_ENTRY: "entry" },
  enforceRateLimit: m.limit,
}));
vi.mock("@/lib/client-ip", () => ({ extractClientIp: () => "ip", hashClientIp: () => "hash" }));
import { POST } from "./route";
const post = (body: unknown) =>
  POST(new Request("https://example.com", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "cmf12345678901234567890123" }),
  });
const body = { address: "kaspa:" + "a".repeat(60), turnstileToken: "test-token" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GIVEAWAY_COVENANT_PROTOTYPE_ENABLED", "true");
  m.ready.mockReturnValue(true);
  m.v6Enabled.mockReturnValue(false);
  m.limit.mockReturnValue({ allowed: true });
  m.normalize.mockReturnValue("kaspa:canonical");
  m.verify.mockResolvedValue({ ok: true });
  m.register.mockResolvedValue(1);
  m.audit.mockResolvedValue(undefined);
  m.chain.mockResolvedValue({ blueScore: 900n, daa: 900n });
  m.script.mockReturnValue("000051");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("public covenant entry endpoint", () => {
  it("requires configured successful verification before any database admission", async () => {
    m.ready.mockReturnValue(false);
    expect((await post(body)).status).toBe(503);
    expect(m.register).not.toHaveBeenCalled();
    m.ready.mockReturnValue(true);
    m.verify.mockResolvedValue({ ok: false, kind: "invalid" });
    expect((await post(body)).status).toBe(403);
    expect(m.register).not.toHaveBeenCalled();
  });
  it("rejects secret or extra fields and invalid addresses", async () => {
    expect((await post({ ...body, privateKey: "never" })).status).toBe(400);
    m.normalize.mockImplementation(() => {
      throw new Error();
    });
    expect((await post(body)).status).toBe(400);
    expect(m.register).not.toHaveBeenCalled();
  });
  it("uses canonical address and reports duplicate-address conflicts", async () => {
    expect((await post(body)).status).toBe(201);
    expect(m.register).toHaveBeenCalledWith("cmf12345678901234567890123", "kaspa:canonical");
    m.register.mockRejectedValue({ code: "P2002" });
    expect((await post(body)).status).toBe(409);
  });
  it("does not expose internal failures", async () => {
    m.register.mockRejectedValue(new Error("private db detail"));
    const r = await post(body);
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("private db detail");
  });

  it("builds and submits a V6 registration from the verified chain projection", async () => {
    m.v6Enabled.mockReturnValue(true);
    m.findUnique.mockResolvedValue(v6Giveaway());
    m.restore.mockReturnValue(v6Projection());
    m.buildV6.mockReturnValue({
      commitmentHex: "cd".repeat(32),
      shardIndex: 2,
      transactionId: "ab".repeat(32),
      transactionSafeJson: '{"public":"transaction"}',
    });
    m.broadcast.mockResolvedValue({
      submittedTransactionId: "ab".repeat(32),
      transactionId: "ab".repeat(32),
    });

    const response = await post(body);
    const result = await response.json();

    expect(response.status).toBe(202);
    expect(m.buildV6).toHaveBeenCalledWith(
      expect.objectContaining({
        activationBlockDaaScore: 800n,
        payoutScriptPublicKeyHex: "000051",
        shardTemplateRedeemScriptHex: "51",
      }),
    );
    expect(m.broadcast).toHaveBeenCalledWith({
      expectedTransactionId: "ab".repeat(32),
      transactionSafeJson: '{"public":"transaction"}',
    });
    expect(result.registration).toEqual({
      commitmentHex: "cd".repeat(32),
      shardIndex: 2,
      status: "SUBMITTED",
      transactionId: "ab".repeat(32),
    });
    expect(m.register).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorType: "PUBLIC",
        event: "giveaway.v6_registration_submitted",
      }),
    );
  });

  it("fails closed after the chain deadline and on a competing shard spend", async () => {
    m.v6Enabled.mockReturnValue(true);
    m.findUnique.mockResolvedValue(v6Giveaway());
    m.restore.mockReturnValue(v6Projection());
    m.chain.mockResolvedValue({ blueScore: 1_000n, daa: 1_000n });
    expect((await post(body)).status).toBe(409);
    expect(m.buildV6).not.toHaveBeenCalled();

    m.chain.mockResolvedValue({ blueScore: 900n, daa: 900n });
    m.buildV6.mockReturnValue({
      commitmentHex: "cd".repeat(32),
      shardIndex: 2,
      transactionId: "ab".repeat(32),
      transactionSafeJson: "{}",
    });
    m.broadcast.mockRejectedValue(new Error("relay rejected transaction: missing outpoint"));
    const response = await post(body);
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("retry in a few seconds");
    expect(m.audit).not.toHaveBeenCalled();
  });
});

function v6Giveaway() {
  return {
    creatorId: "creator-id",
    publicId: "cmf12345678901234567890123",
    v6Bootstrap: { shardTemplateRedeemScriptHex: "51" },
    v6Projection: { lastErrorCode: null, phase: "OPEN" },
  };
}

function v6Projection() {
  return {
    checkpoint: {
      transitions: [
        {
          event: {
            kind: "activate",
            blockDaaScore: 800n,
          },
        },
      ],
    },
    config: { closesAtDaa: 1_000n },
    family: {},
    snapshot: { observedRegistrationCount: 3, phase: "open" },
  };
}
