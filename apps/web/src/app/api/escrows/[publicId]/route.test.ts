import { createRequire } from "node:module";

import type { EscrowLinkPrototype } from "@kaspa-actions/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  broadcast: vi.fn(),
  chain: vi.fn(),
  limit: vi.fn(),
  utxos: vi.fn(),
  db: {
    escrowLinkPrototype: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { PUBLIC: "PUBLIC" },
  prisma: mocks.db,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/giveaway-prize-v3-chain", () => ({
  readPrototypeChain: mocks.chain,
  readPrototypeUtxos: mocks.utxos,
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: {
    ESCROW_LINK_PUBLIC_MUTATION: "mutation",
    ESCROW_LINK_PUBLIC_STATUS: "status",
  },
}));
vi.mock("@/lib/toccata-lab", () => ({
  broadcastToccataPreparedTransaction: mocks.broadcast,
}));

import { createEscrowV1Terms } from "@/lib/escrow-canary";
import { GET, POST } from "./route";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const buyerKey = new sdk.PrivateKey("31".repeat(32));
const sellerKey = new sdk.PrivateKey("32".repeat(32));
const buyerAddress = new sdk.PrivateKey("33".repeat(32))
  .toPublicKey()
  .toAddress("mainnet")
  .toString();
const sellerAddress = new sdk.PrivateKey("34".repeat(32))
  .toPublicKey()
  .toAddress("mainnet")
  .toString();
const publicId = "cm12345678901234567890123";

function initialRow(): EscrowLinkPrototype & { creator: { username: string } } {
  return {
    activeFundingAddress: null,
    amountSompi: 21_000_000n,
    buyerAddress: null,
    buyerPublicKey: null,
    claimTxId: null,
    createdAt: new Date(0),
    creator: { username: "example" },
    creatorId: "creator",
    durationDaa: 36_000n,
    feeSompi: 1_000_000n,
    frozenFundingAddress: null,
    id: "row-id",
    joinedAt: null,
    publicId,
    refundTxId: null,
    releaseAfter: null,
    releaseTxId: null,
    sellerAddress,
    sellerPublicKey: sellerKey.toPublicKey().toXOnlyPublicKey().toString(),
    signerContextId: "escrow-route-context",
    status: "awaiting_buyer",
    title: "Logo delivery",
    updatedAt: new Date(0),
  };
}

function joinedRow(): EscrowLinkPrototype & { creator: { username: string } } {
  const row = initialRow();
  const terms = createEscrowV1Terms({
    amount: row.amountSompi,
    buyerAddress,
    buyerPublicKey: buyerKey.toPublicKey().toXOnlyPublicKey().toString(),
    fee: row.feeSompi,
    releaseAfter: 600_036_000n,
    sellerAddress,
    sellerPublicKey: row.sellerPublicKey,
  });
  return {
    ...row,
    activeFundingAddress: terms.active.address,
    buyerAddress,
    buyerPublicKey: terms.parameters.buyerPublicKey,
    frozenFundingAddress: terms.frozen.address,
    joinedAt: new Date(1),
    releaseAfter: terms.parameters.releaseAfter,
    status: "awaiting_funding",
  };
}

const context = { params: Promise.resolve({ publicId }) };
const post = (body: unknown) =>
  POST(
    new Request(`https://kaspalinks.com/api/escrows/${publicId}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-real-ip": "192.0.2.1" },
      method: "POST",
    }),
    context,
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ESCROW_LINKS_PROTOTYPE_ENABLED", "true");
  mocks.limit.mockReturnValue({ allowed: true });
  mocks.chain.mockResolvedValue({ blueScore: 600_000_000n, daa: 600_000_000n });
  mocks.utxos.mockResolvedValue([
    {
      amount: "22000000",
      blockDaaScore: "600000001",
      index: 0,
      transactionId: "ab".repeat(32),
    },
  ]);
  mocks.db.escrowLinkPrototype.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public two-party escrow route", () => {
  it("returns the invitation without creating a funding address early", async () => {
    mocks.db.escrowLinkPrototype.findUnique.mockResolvedValue(initialRow());
    const response = await GET(
      new Request(`https://kaspalinks.com/api/escrows/${publicId}`),
      context,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).escrow).toMatchObject({
      activeFundingAddress: null,
      funding: { state: "not_ready" },
      status: "awaiting_buyer",
    });
    expect(mocks.chain).not.toHaveBeenCalled();
  });

  it("atomically binds the first buyer using only public commitment material", async () => {
    const initial = initialRow();
    const joined = joinedRow();
    mocks.db.escrowLinkPrototype.findUnique
      .mockResolvedValueOnce(initial)
      .mockResolvedValue(joined);
    const response = await post({
      action: "join",
      buyerAddress,
      buyerPublicKey: joined.buyerPublicKey,
    });
    expect(response.status).toBe(200);
    const data = mocks.db.escrowLinkPrototype.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ buyerAddress, buyerPublicKey: joined.buyerPublicKey });
    expect(Object.keys(data).join(" ")).not.toMatch(/private|prf|seed|recovery/iu);
    expect(mocks.db.escrowLinkPrototype.updateMany.mock.calls[0][0].where).toMatchObject({
      buyerPublicKey: null,
      status: "awaiting_buyer",
    });
  });

  it("rejects a second buyer and never changes the commitment", async () => {
    mocks.db.escrowLinkPrototype.findUnique.mockResolvedValue(joinedRow());
    const response = await post({
      action: "join",
      buyerAddress,
      buyerPublicKey: "44".repeat(32),
    });
    expect(response.status).toBe(409);
    expect(mocks.db.escrowLinkPrototype.updateMany).not.toHaveBeenCalled();
  });

  it("prepares release for the buyer key and blocks an early seller claim", async () => {
    mocks.db.escrowLinkPrototype.findUnique.mockResolvedValue(joinedRow());
    const release = await post({ action: "prepare", mode: "release" });
    expect(release.status).toBe(200);
    expect((await release.json()).review).toMatchObject({
      destinationAddress: sellerAddress,
      requiredRole: "buyer",
    });
    const claim = await post({ action: "prepare", mode: "claim" });
    expect(claim.status).toBe(409);
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
});
