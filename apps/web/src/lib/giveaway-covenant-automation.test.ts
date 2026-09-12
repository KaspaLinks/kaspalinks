import { createRequire } from "node:module";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  execute: vi.fn(),
  chain: vi.fn(),
  utxos: vi.fn(),
  payout: vi.fn(),
}));
vi.mock("@kaspa-actions/db", () => ({
  prisma: {
    covenantPrototype: { findMany: m.findMany, updateMany: m.updateMany, update: m.update },
    auditLog: { findFirst: m.audit },
  },
}));
vi.mock("./giveaway-covenant-execution", () => ({ executeCovenantAction: m.execute }));
vi.mock("./giveaway-prize-v3-chain", () => ({
  readPrototypeChain: m.chain,
  readPrototypeUtxos: m.utxos,
  readPrototypePayout: m.payout,
}));
import { processCovenantGiveaways } from "./giveaway-covenant-automation";
import { createPrototypeManifest } from "./giveaway-prize-v3-prototype";
const sdk = createRequire(import.meta.url)("kaspa-wasm");
const pk = new sdk.PrivateKey("22".repeat(32)).toPublicKey().toXOnlyPublicKey().toString();
const manifest = createPrototypeManifest(
  { publicTitle: "Auto test", creatorPublicKeyHex: pk, prizeSompi: "100000000", addresses: [] },
  { daa: 10000n, blueScore: 10000n, platformPublicKeyHex: pk },
);
const row = {
  id: "trial",
  creatorId: "owner",
  manifest,
  entriesFrozenAt: null,
  automationNextAt: new Date(0),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("GIVEAWAY_COVENANT_PROTOTYPE_ENABLED", "true");
  m.findMany.mockResolvedValue([row]);
  m.updateMany.mockResolvedValue({ count: 1 });
  m.chain.mockResolvedValue({ daa: 14000n, blueScore: 14000n });
  m.utxos.mockResolvedValue([]);
  m.execute.mockResolvedValue(new Response("{}"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe("automatic covenant processing", () => {
  it("claims due V4 trials and submits freeze without creator credentials", async () => {
    await processCovenantGiveaways();
    expect(m.findMany.mock.calls[0]![0].where.manifest).toEqual({ path: ["version"], equals: 4 });
    expect(m.execute).toHaveBeenCalledWith({ action: "freeze", id: "trial" }, "owner", "SYSTEM");
  });
  it("does not process work leased elsewhere or before closing", async () => {
    m.updateMany.mockResolvedValue({ count: 0 });
    await processCovenantGiveaways();
    expect(m.execute).not.toHaveBeenCalled();
    m.updateMany.mockResolvedValue({ count: 1 });
    m.chain.mockResolvedValue({ daa: 12000n });
    await processCovenantGiveaways();
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("draws a funded nonempty frozen list", async () => {
    m.findMany.mockResolvedValue([
      {
        ...row,
        entriesFrozenAt: new Date(),
        manifest: {
          ...manifest,
          entries: [
            {
              address: "kaspa:public",
              scriptPublicKeyHex: "000020" + "11".repeat(32) + "ac",
              hash: "33".repeat(32),
            },
          ],
        },
      },
    ]);
    m.utxos.mockResolvedValue([{ amount: "101000000" }]);
    await processCovenantGiveaways();
    expect(m.execute).toHaveBeenCalledWith({ action: "draw", id: "trial" }, "owner", "SYSTEM");
  });
  it("stops only after confirming a payout or an exact empty frozen output", async () => {
    m.audit.mockResolvedValue({ metadata: { transactionId: "ab".repeat(32) } });
    m.payout.mockResolvedValue({ confirmed: true });
    await processCovenantGiveaways();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.update.mock.calls[0]![0].data.automationFinishedAt).toBeInstanceOf(Date);
  });
  it("leaves transient failures retryable and ignores unrelated dust", async () => {
    m.findMany.mockResolvedValue([{ ...row, entriesFrozenAt: new Date() }]);
    m.utxos.mockResolvedValue([{ amount: "1" }]);
    m.execute.mockRejectedValue(new Error("unavailable"));
    await expect(processCovenantGiveaways()).resolves.toBeUndefined();
    expect(m.update).not.toHaveBeenCalled();
  });
});
