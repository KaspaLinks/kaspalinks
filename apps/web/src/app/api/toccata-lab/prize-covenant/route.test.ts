import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  limit: vi.fn(),
  audit: vi.fn(),
  refund: vi.fn(),
  payout: vi.fn(),
  chain: vi.fn(),
  utxos: vi.fn(),
  entropy: vi.fn(),
  verifyEntropy: vi.fn(),
  broadcast: vi.fn(),
  db: {
    auditLog: { findFirst: vi.fn() },
    covenantPrototype: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));
vi.mock("@kaspa-actions/db", () => ({
  prisma: mocks.db,
  Prisma: { DbNull: "DB_NULL" },
  AuditActorType: { CREATOR: "CREATOR" },
}));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_MUTATION: "test" },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/giveaway-prize-v3-chain", () => ({
  readPrototypeRefund: mocks.refund,
  readPrototypePayout: mocks.payout,
  readPrototypeChain: mocks.chain,
  readPrototypeUtxos: mocks.utxos,
  readPrototypeEntropy: mocks.entropy,
  verifyPrototypeEntropy: mocks.verifyEntropy,
}));
vi.mock("@/lib/toccata-lab", () => ({ broadcastToccataPreparedTransaction: mocks.broadcast }));
import { GET, POST } from "./route";
import { createPrototypeManifest } from "@/lib/giveaway-prize-v3-prototype";
import { giveawayPrizeV3PlatformPublicKey } from "@/lib/giveaway-prize-v3-attest";
const sdk = createRequire(import.meta.url)("kaspa-wasm");
const id = "cmf12345678901234567890123";
const post = (body: unknown) =>
  POST(
    new Request("https://example.com/api/toccata-lab/prize-covenant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const trial = () => ({
  id,
  manifest: createPrototypeManifest(
    {
      creatorPublicKeyHex: new sdk.PrivateKey("22".repeat(32))
        .toPublicKey()
        .toXOnlyPublicKey()
        .toString(),
      prizeSompi: "100000000",
      addresses: ["33", "44"].map((v) =>
        new sdk.PrivateKey(v.repeat(32)).toPublicKey().toAddress("mainnet").toString(),
      ),
    },
    {
      daa: 536000000n,
      blueScore: 535000000n,
      platformPublicKeyHex: giveawayPrizeV3PlatformPublicKey(),
    },
  ),
  entropy: null,
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GIVEAWAY_COVENANT_PROTOTYPE_ENABLED", "true");
  vi.stubEnv("GIVEAWAY_PLATFORM_SIGNING_KEY", "11".repeat(32));
  mocks.guard.mockResolvedValue({
    ok: true,
    creator: { id: "creator", prizeCovenantEnabled: true },
  });
  mocks.limit.mockReturnValue({ allowed: true });
  mocks.chain.mockResolvedValue({ daa: 536004000n, blueScore: 535004000n });
  mocks.utxos.mockResolvedValue([
    { transactionId: "ab".repeat(32), index: 0, amount: "101000000", blockDaaScore: "536003100" },
  ]);
  mocks.broadcast.mockResolvedValue({ transactionId: "ef".repeat(32) });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("prototype access and transitions", () => {
  it("restores a confirmed payout from creator-scoped audit history", async () => {
    const row = trial();
    mocks.db.covenantPrototype.findFirst.mockResolvedValue(row);
    mocks.db.auditLog.findFirst
      .mockResolvedValueOnce({ metadata: { transactionId: "ab".repeat(32) } })
      .mockResolvedValueOnce(null);
    const payout = {
      transactionId: "ab".repeat(32),
      confirmed: true,
      winnerAddress: row.manifest.entries[0]!.address,
    };
    mocks.payout.mockResolvedValue(payout);
    const response = await GET(new Request(`https://example.com?id=${id}`));
    expect(response.status).toBe(200);
    expect((await response.json()).payout).toEqual(payout);
    expect(mocks.db.auditLog.findFirst.mock.calls[0][0].where.creatorId).toBe("creator");
  });
  it("restores only the selected creator giveaway refund receipt", async () => {
    mocks.db.covenantPrototype.findFirst.mockResolvedValue(trial());
    mocks.db.auditLog.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ metadata: { transactionId: "ab".repeat(32) } });
    const refund = {
      transactionId: "ab".repeat(32),
      confirmed: true,
      address: "kaspa:test",
      amount: "100000000",
    };
    mocks.refund.mockResolvedValue(refund);
    const response = await GET(new Request(`https://example.com?id=${id}`));
    expect((await response.json()).refund).toEqual(refund);
    expect(mocks.db.auditLog.findFirst.mock.calls[1][0].where).toMatchObject({
      creatorId: "creator",
      AND: [
        { metadata: { path: ["prototypeId"], equals: id } },
        { metadata: { path: ["mode"], equals: "broadcast-refund" } },
      ],
    });
  });
  it("does not expose prototypes without the explicit feature gate", async () => {
    vi.stubEnv("GIVEAWAY_COVENANT_PROTOTYPE_ENABLED", "false");
    expect((await GET(new Request("https://example.com"))).status).toBe(404);
    expect(mocks.guard).not.toHaveBeenCalled();
  });
  it("requires individual creator access", async () => {
    mocks.guard.mockResolvedValue({
      ok: true,
      creator: { id: "creator", prizeCovenantEnabled: false },
    });
    expect((await post({ action: "draw", id })).status).toBe(403);
    expect(mocks.db.covenantPrototype.findFirst).not.toHaveBeenCalled();
  });
  it("scopes every selected trial to its creator", async () => {
    mocks.db.covenantPrototype.findFirst.mockResolvedValue(null);
    expect((await post({ action: "draw", id })).status).toBe(404);
    expect(mocks.db.covenantPrototype.findFirst).toHaveBeenCalledWith({
      where: { id, creatorId: "creator" },
    });
  });
  it("rejects recovery material and caller-selected entropy in request bodies", async () => {
    expect((await post({ action: "draw", id, privateKey: "do-not-accept" })).status).toBe(400);
    expect((await post({ action: "draw", id, blockHash: "ab".repeat(32) })).status).toBe(400);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("persists the first entropy selection atomically and uses the saved result", async () => {
    const row = trial();
    mocks.db.covenantPrototype.findFirst.mockResolvedValue(row);
    const entropy = {
      blockHash: "7a".repeat(32),
      blockBlueScore: "535003600",
      seedHex: "5c".repeat(32),
    };
    mocks.entropy.mockResolvedValue(entropy);
    mocks.db.covenantPrototype.findUniqueOrThrow.mockResolvedValue({ ...row, entropy });
    expect((await post({ action: "draw", id })).status).toBe(200);
    expect(mocks.db.covenantPrototype.updateMany).toHaveBeenCalledWith({
      where: { id, entropy: { equals: "DB_NULL" } },
      data: { entropy },
    });
    expect(mocks.verifyEntropy).toHaveBeenCalledWith(entropy);
    expect(mocks.broadcast).toHaveBeenCalledOnce();
  });
  it("does not reroll when an already attested block fails verification", async () => {
    mocks.db.covenantPrototype.findFirst.mockResolvedValue({
      ...trial(),
      entropy: {
        blockHash: "7a".repeat(32),
        blockBlueScore: "535003600",
        seedHex: "5c".repeat(32),
      },
    });
    mocks.verifyEntropy.mockRejectedValue(new Error("Entropy commitment changed."));
    expect((await post({ action: "draw", id })).status).toBe(409);
    expect(mocks.entropy).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("never prepares a refund before its deadline", async () => {
    mocks.db.covenantPrototype.findFirst.mockResolvedValue(trial());
    expect(
      (
        await post({
          action: "prepare-refund",
          id,
          phase: "open",
          refundAddress: new sdk.PrivateKey("22".repeat(32))
            .toPublicKey()
            .toAddress("mainnet")
            .toString(),
        })
      ).status,
    ).toBe(409);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("ignores a dust output when selecting the funded covenant output", async () => {
    const row = trial();
    mocks.db.covenantPrototype.findFirst.mockResolvedValue(row);
    mocks.utxos.mockResolvedValue([
      { transactionId: "00".repeat(32), index: 0, amount: "1", blockDaaScore: "536001000" },
      { transactionId: "ab".repeat(32), index: 0, amount: "102000000", blockDaaScore: "536002000" },
    ]);
    expect((await post({ action: "freeze", id })).status).toBe(200);
    expect(mocks.broadcast).toHaveBeenCalledOnce();
  });
  it("requires funding before the committed close for freezing", async () => {
    mocks.db.covenantPrototype.findFirst.mockResolvedValue(trial());
    mocks.utxos.mockResolvedValue([
      { transactionId: "ab".repeat(32), index: 0, amount: "102000000", blockDaaScore: "536003001" },
    ]);
    expect((await post({ action: "freeze", id })).status).toBe(409);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
