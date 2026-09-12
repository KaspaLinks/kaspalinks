import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const mocks = vi.hoisted(() => ({
  chain: vi.fn(),
  utxos: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    covenantPrototype: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    covenantRegistration: { count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));
vi.mock("@kaspa-actions/db", () => ({
  Prisma: { sql: (s: unknown) => s },
  prisma: { $transaction: (fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx) },
}));
vi.mock("./giveaway-prize-v3-chain", () => ({
  readPrototypeChain: mocks.chain,
  readPrototypeUtxos: mocks.utxos,
}));
import {
  registerPublicCovenant,
  freezePublicCovenant,
  publicCovenantVerificationReady,
} from "./public-covenant";
import { createPrototypeManifest, prototypeTerms } from "./giveaway-prize-v3-prototype";
const sdk = createRequire(import.meta.url)("kaspa-wasm");
const publicKey = new sdk.PrivateKey("22".repeat(32)).toPublicKey().toXOnlyPublicKey().toString();
const manifest = createPrototypeManifest(
  {
    publicTitle: "Public trial",
    addresses: [],
    prizeSompi: "100000000",
    creatorPublicKeyHex: publicKey,
  },
  { daa: 10000n, blueScore: 10000n, platformPublicKeyHex: publicKey },
);
const row = {
  id: "test",
  creatorId: "owner",
  publicTitle: "Public trial",
  manifest,
  entriesFrozenAt: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.covenantPrototype.findUnique.mockResolvedValue(row);
  mocks.tx.covenantPrototype.findFirst.mockResolvedValue(row);
  mocks.chain.mockResolvedValue({ daa: 11000n, blueScore: 11000n });
  mocks.utxos.mockResolvedValue([
    { amount: prototypeTerms(manifest).fundingSompi, blockDaaScore: "10500" },
  ]);
  mocks.tx.covenantRegistration.count.mockResolvedValue(1);
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("public covenant admission", () => {
  it("fails closed when verification is disabled or not configured", () => {
    vi.stubEnv("GIVEAWAY_TURNSTILE_ENABLED", "false");
    expect(publicCovenantVerificationReady()).toBe(false);
    vi.stubEnv("GIVEAWAY_TURNSTILE_ENABLED", "true");
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(publicCovenantVerificationReady()).toBe(false);
  });
  it("locks before admission and audits a successful entry", async () => {
    await registerPublicCovenant("test", "kaspa:participant");
    expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
    expect(mocks.tx.covenantRegistration.create).toHaveBeenCalledOnce();
    expect(mocks.tx.auditLog.create).toHaveBeenCalledOnce();
  });
  it("rejects a deadline crossed during the funding lookup", async () => {
    mocks.chain.mockResolvedValueOnce({ daa: 11000n }).mockResolvedValueOnce({ daa: 13000n });
    await expect(registerPublicCovenant("test", "a")).rejects.toThrow(/closed/);
    expect(mocks.tx.covenantRegistration.create).not.toHaveBeenCalled();
  });
  it("rejects full, frozen and unfunded giveaways", async () => {
    mocks.tx.covenantRegistration.count.mockResolvedValue(100);
    await expect(registerPublicCovenant("test", "a")).rejects.toThrow(/full/);
    mocks.tx.covenantPrototype.findUnique.mockResolvedValue({
      ...row,
      entriesFrozenAt: new Date(),
    });
    await expect(registerPublicCovenant("test", "a")).rejects.toThrow(/closed/);
    mocks.tx.covenantPrototype.findUnique.mockResolvedValue(row);
    mocks.utxos.mockResolvedValue([]);
    await expect(registerPublicCovenant("test", "a")).rejects.toThrow(/funding/);
  });
  it("does not replace a frozen snapshot or invent participants", async () => {
    mocks.tx.covenantPrototype.findFirst.mockResolvedValue({ ...row, entriesFrozenAt: new Date() });
    await freezePublicCovenant("test", "owner");
    expect(mocks.tx.covenantPrototype.update).not.toHaveBeenCalled();
    mocks.tx.covenantPrototype.findFirst.mockResolvedValue(row);
    mocks.chain.mockResolvedValue({ daa: 14000n });
    mocks.tx.covenantRegistration.findMany.mockResolvedValue([]);
    await expect(freezePublicCovenant("test", "owner")).rejects.toThrow(/No participants/);
  });
});
