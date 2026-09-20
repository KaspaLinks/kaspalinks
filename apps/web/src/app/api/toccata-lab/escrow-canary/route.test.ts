import { createRequire } from "node:module";

import type { EscrowPrototype } from "@kaspa-actions/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  broadcast: vi.fn(),
  chain: vi.fn(),
  guard: vi.fn(),
  limit: vi.fn(),
  utxos: vi.fn(),
  db: {
    escrowPrototype: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  prisma: mocks.db,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/giveaway-prize-v3-chain", () => ({
  readPrototypeChain: mocks.chain,
  readPrototypeUtxos: mocks.utxos,
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: { ESCROW_CANARY_MUTATION: "mutation", ESCROW_PROTOTYPE_ACCESS: "access" },
}));
vi.mock("@/lib/toccata-lab", () => ({
  broadcastToccataPreparedTransaction: mocks.broadcast,
}));

import { createEscrowCanaryTerms, prepareEscrowCanaryTransaction } from "@/lib/escrow-canary";
import { GET, POST } from "./route";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const buyer = new sdk.PrivateKey("21".repeat(32));
const seller = new sdk.PrivateKey("22".repeat(32));
const payout = new sdk.PrivateKey("23".repeat(32)).toPublicKey().toAddress("mainnet").toString();
const utxo = {
  amount: "22000000",
  blockDaaScore: "600000001",
  index: 0,
  transactionId: "ab".repeat(32),
};

function row(): EscrowPrototype {
  const terms = createEscrowCanaryTerms({
    buyerPublicKey: buyer.toPublicKey().toXOnlyPublicKey().toString(),
    chainDaa: 600_000_000n,
    payoutAddress: payout,
    sellerPublicKey: seller.toPublicKey().toXOnlyPublicKey().toString(),
  });
  return {
    id: "cm12345678901234567890123",
    creatorId: "creator",
    signerContextId: "canary-route-test",
    amountSompi: terms.parameters.amount,
    feeSompi: terms.parameters.fee,
    releaseAfter: terms.parameters.releaseAfter,
    buyerPublicKey: terms.parameters.buyerPublicKey,
    sellerPublicKey: terms.parameters.sellerPublicKey,
    buyerAddress: payout,
    sellerAddress: payout,
    activeFundingAddress: terms.active.address,
    frozenFundingAddress: terms.frozen.address,
    status: "awaiting_funding",
    releaseTxId: null,
    refundTxId: null,
    claimTxId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const post = (body: unknown) =>
  POST(
    new Request("https://kaspalinks.com/api/toccata-lab/escrow-canary", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ESCROW_LINKS_PROTOTYPE_ENABLED", "true");
  vi.stubEnv("ESCROW_LINKS_PROTOTYPE_CREATORS", "example");
  mocks.guard.mockResolvedValue({
    creator: { id: "creator", username: "example" },
    ipHash: "ip",
    ok: true,
  });
  mocks.limit.mockReturnValue({ allowed: true });
  mocks.chain.mockResolvedValue({ blueScore: 599_000_000n, daa: 600_000_100n });
  mocks.utxos.mockResolvedValue([utxo]);
  mocks.db.escrowPrototype.updateMany.mockResolvedValue({ count: 1 });
  mocks.broadcast.mockResolvedValue({
    submittedTransactionId: "cd".repeat(32),
    transactionId: "cd".repeat(32),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("escrow canary route", () => {
  it("stays hidden from creators outside the allowlist", async () => {
    vi.stubEnv("ESCROW_LINKS_PROTOTYPE_CREATORS", "someone-else");
    expect(
      (await GET(new Request("https://kaspalinks.com/api/toccata-lab/escrow-canary"))).status,
    ).toBe(404);
    expect(mocks.db.escrowPrototype.findFirst).not.toHaveBeenCalled();
  });

  it("returns an empty restore result before the first canary", async () => {
    mocks.db.escrowPrototype.findFirst.mockResolvedValue(null);
    const response = await GET(new Request("https://kaspalinks.com/api/toccata-lab/escrow-canary"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canary: null });
  });

  it("creates only public commitment material", async () => {
    const saved = row();
    mocks.db.escrowPrototype.create.mockResolvedValue(saved);
    const response = await post({
      action: "create",
      buyerPublicKey: saved.buyerPublicKey,
      payoutAddress: payout,
      sellerPublicKey: saved.sellerPublicKey,
      signerContextId: saved.signerContextId,
    });
    expect(response.status).toBe(201);
    const data = mocks.db.escrowPrototype.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      amountSompi: 21_000_000n,
      feeSompi: 1_000_000n,
      buyerAddress: payout,
      sellerAddress: payout,
    });
    expect(Object.keys(data).join(" ")).not.toMatch(/private|prf|recovery|seed/iu);
  });

  it("prepares release but blocks claim before the committed DAA", async () => {
    const saved = row();
    mocks.db.escrowPrototype.findFirst.mockResolvedValue(saved);
    expect((await post({ action: "prepare", id: saved.id, mode: "release" })).status).toBe(200);
    expect((await post({ action: "prepare", id: saved.id, mode: "claim" })).status).toBe(409);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it("reconstructs a signed release before broadcasting", async () => {
    const saved = row();
    mocks.db.escrowPrototype.findFirst.mockResolvedValue(saved);
    const prepared = prepareEscrowCanaryTransaction(saved, "release", utxo);
    const transaction = sdk.Transaction.deserializeFromSafeJSON(prepared.transactionSafeJson);
    const signature = sdk.createInputSignature(transaction, 0, buyer, sdk.SighashType.All);
    transaction.inputs[0]!.signatureScript =
      signature + transaction.inputs[0]!.signatureScript!.slice(132);
    transaction.finalize();
    const signed = transaction.serializeToSafeJSON();
    mocks.broadcast.mockResolvedValue({
      submittedTransactionId: transaction.id,
      transactionId: transaction.id,
    });

    const response = await post({
      action: "broadcast",
      id: saved.id,
      mode: "release",
      transactionSafeJson: signed,
    });
    expect(response.status).toBe(200);
    expect(mocks.broadcast).toHaveBeenCalledWith({
      expectedTransactionId: transaction.id,
      transactionSafeJson: signed,
    });
    expect(mocks.db.escrowPrototype.update).toHaveBeenCalledWith({
      where: { id: saved.id },
      data: { releaseTxId: transaction.id, status: "submitted" },
    });
  });

  it("rejects changed output data before the relay", async () => {
    const saved = row();
    mocks.db.escrowPrototype.findFirst.mockResolvedValue(saved);
    const prepared = prepareEscrowCanaryTransaction(saved, "release", utxo);
    const changed = JSON.parse(prepared.transactionSafeJson);
    changed.outputs[0].value = "1";
    const response = await post({
      action: "broadcast",
      id: saved.id,
      mode: "release",
      transactionSafeJson: JSON.stringify(changed),
    });
    expect(response.status).toBe(409);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
