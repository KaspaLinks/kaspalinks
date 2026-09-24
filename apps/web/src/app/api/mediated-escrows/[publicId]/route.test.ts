import { createRequire } from "node:module";

import type { MediatedEscrowPrototype } from "@kaspa-actions/db";
import { ESCROW_V2_TEMPLATE_HASH } from "@kaspa-actions/kaspa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  broadcast: vi.fn(),
  chain: vi.fn(),
  limit: vi.fn(),
  utxos: vi.fn(),
  db: {
    mediatedEscrowPrototype: {
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

import {
  createMediatedEscrowTerms,
  MEDIATED_ESCROW_AMOUNT_SOMPI,
  MEDIATED_ESCROW_FALLBACK_DAA,
  MEDIATED_ESCROW_FEE_SOMPI,
  MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
  prepareMediatedEscrowTransaction,
} from "@/lib/mediated-escrow-v2";
import { GET, POST } from "./route";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const sellerKey = new sdk.PrivateKey("31".repeat(32));
const mediatorKey = new sdk.PrivateKey("32".repeat(32));
const buyerKey = new sdk.PrivateKey("33".repeat(32));
const publicKey = (key: typeof sellerKey) => key.toPublicKey().toXOnlyPublicKey().toString();
const address = (key: typeof sellerKey) => key.toPublicKey().toAddress("mainnet").toString();
const publicId = "cm12345678901234567890123";

type Row = MediatedEscrowPrototype & { creator: { username: string } };

function initialRow(): Row {
  return {
    activeFundingAddress: null,
    agreementTxId: null,
    amountSompi: MEDIATED_ESCROW_AMOUNT_SOMPI,
    arbitrationTxId: null,
    buyerAddress: null,
    buyerJoinedAt: null,
    buyerPublicKey: null,
    claimDelayDaa: 6_048_000n,
    claimTxId: null,
    contractTemplateHash: ESCROW_V2_TEMPLATE_HASH,
    createdAt: new Date(0),
    creator: { username: "example" },
    creatorId: "creator",
    fallbackDelayDaa: MEDIATED_ESCROW_FALLBACK_DAA,
    fallbackTxId: null,
    feeSompi: MEDIATED_ESCROW_FEE_SOMPI,
    freezeTxId: null,
    frozenFundingAddress: null,
    id: "row-id",
    mediatorJoinedAt: null,
    mediatorLabel: "Independent reviewer",
    mediatorPublicKey: null,
    pendingBuyerShare: null,
    pendingCreatedAt: null,
    pendingMediatorParty: null,
    pendingMode: null,
    pendingTransactionJson: null,
    publicId,
    refundTxId: null,
    releaseTxId: null,
    sellerAddress: address(sellerKey),
    sellerPublicKey: publicKey(sellerKey),
    signerContextId: "mediated-route-context",
    status: "awaiting_mediator",
    title: "Physical item",
    updatedAt: new Date(0),
  };
}

function mediatorRow(): Row {
  return {
    ...initialRow(),
    mediatorJoinedAt: new Date(1),
    mediatorPublicKey: publicKey(mediatorKey),
    status: "awaiting_buyer",
  };
}

function joinedRow(): Row {
  const row = mediatorRow();
  const terms = createMediatedEscrowTerms({
    buyerAddress: address(buyerKey),
    buyerPublicKey: publicKey(buyerKey),
    claimDelayDaa: row.claimDelayDaa,
    mediatorPublicKey: row.mediatorPublicKey!,
    sellerAddress: row.sellerAddress,
    sellerPublicKey: row.sellerPublicKey,
  });
  return {
    ...row,
    activeFundingAddress: terms.active.address,
    buyerAddress: address(buyerKey),
    buyerJoinedAt: new Date(2),
    buyerPublicKey: publicKey(buyerKey),
    frozenFundingAddress: terms.frozen.address,
    status: "awaiting_funding",
  };
}

const activeUtxo = {
  amount: "22000000",
  blockDaaScore: "600000000",
  index: 0,
  transactionId: "ab".repeat(32),
};
const frozenUtxo = {
  amount: "21000000",
  blockDaaScore: "600000000",
  index: 0,
  transactionId: "cd".repeat(32),
};
const context = { params: Promise.resolve({ publicId }) };
const post = (body: unknown) =>
  POST(
    new Request(`https://kaspalinks.com/api/mediated-escrows/${publicId}`, {
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
  mocks.chain.mockResolvedValue({ blueScore: 700_000_000n, daa: 700_000_000n });
  mocks.utxos.mockResolvedValue([]);
  mocks.db.mediatedEscrowPrototype.updateMany.mockResolvedValue({ count: 1 });
  mocks.broadcast.mockResolvedValue({
    submittedTransactionId: "ff".repeat(32),
    transactionId: "ee".repeat(32),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public mediated escrow route", () => {
  it("onboards the selected mediator before exposing any funding address", async () => {
    mocks.db.mediatedEscrowPrototype.findUnique
      .mockResolvedValueOnce(initialRow())
      .mockResolvedValue(mediatorRow());
    const response = await post({
      action: "joinMediator",
      mediatorPublicKey: publicKey(mediatorKey),
    });
    expect(response.status).toBe(200);
    expect(mocks.db.mediatedEscrowPrototype.updateMany.mock.calls[0][0]).toMatchObject({
      data: { mediatorPublicKey: publicKey(mediatorKey), status: "awaiting_buyer" },
      where: { mediatorPublicKey: null, status: "awaiting_mediator" },
    });
    expect((await response.json()).escrow.activeFundingAddress).toBeNull();
    expect(mocks.utxos).not.toHaveBeenCalled();
  });

  it("commits the first buyer and all three distinct public keys atomically", async () => {
    mocks.db.mediatedEscrowPrototype.findUnique
      .mockResolvedValueOnce(mediatorRow())
      .mockResolvedValue(joinedRow());
    const response = await post({
      action: "joinBuyer",
      buyerAddress: address(buyerKey),
      buyerPublicKey: publicKey(buyerKey),
    });
    expect(response.status).toBe(200);
    const data = mocks.db.mediatedEscrowPrototype.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      buyerPublicKey: publicKey(buyerKey),
      status: "awaiting_funding",
    });
    expect(Object.keys(data).join(" ")).not.toMatch(/private|prf|seed|recovery/iu);
  });

  it("prepares and relays a buyer-signed freeze without accepting changed intent", async () => {
    const row = joinedRow();
    mocks.db.mediatedEscrowPrototype.findUnique.mockResolvedValue(row);
    mocks.utxos.mockImplementation(async (fundingAddress: string) =>
      fundingAddress === row.activeFundingAddress ? [activeUtxo] : [],
    );
    const prepared = prepareMediatedEscrowTransaction({
      mode: "freeze",
      row,
      utxo: activeUtxo,
    });
    const transaction = sdk.Transaction.deserializeFromSafeJSON(prepared.transactionSafeJson);
    const signature = sdk.createInputSignature(transaction, 0, buyerKey, sdk.SighashType.All);
    transaction.inputs[0]!.signatureScript =
      signature + transaction.inputs[0]!.signatureScript!.slice(132);
    transaction.finalize();
    const response = await post({
      action: "saveSignature",
      mode: "freeze",
      role: "buyer",
      transactionSafeJson: transaction.serializeToSafeJSON(),
    });
    expect(response.status).toBe(200);
    expect(mocks.broadcast).toHaveBeenCalledTimes(1);
    expect(mocks.db.mediatedEscrowPrototype.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ freezeTxId: "ee".repeat(32), status: "freeze_submitted" }),
      where: { id: row.id },
    });
  });

  it("stores a mediator award signature until the winning party co-signs", async () => {
    const row = { ...joinedRow(), freezeTxId: "dd".repeat(32), status: "freeze_submitted" };
    mocks.db.mediatedEscrowPrototype.findUnique.mockResolvedValue(row);
    mocks.utxos.mockImplementation(async (fundingAddress: string) =>
      fundingAddress === row.frozenFundingAddress ? [frozenUtxo] : [],
    );
    const prepared = prepareMediatedEscrowTransaction({
      buyerShareSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
      mediatorParty: "buyer",
      mode: "arbitrate",
      row,
      utxo: frozenUtxo,
    });
    const transaction = sdk.Transaction.deserializeFromSafeJSON(prepared.transactionSafeJson);
    const signature = sdk.createInputSignature(transaction, 0, mediatorKey, sdk.SighashType.All);
    const script = transaction.inputs[0]!.signatureScript!;
    transaction.inputs[0]!.signatureScript = script.slice(0, 132) + signature + script.slice(264);
    transaction.finalize();
    const response = await post({
      action: "saveSignature",
      buyerShareSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI.toString(),
      mediatorParty: "buyer",
      mode: "arbitrate",
      role: "mediator",
      transactionSafeJson: transaction.serializeToSafeJSON(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ complete: false, pending: true });
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.db.mediatedEscrowPrototype.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pendingBuyerShare: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
        pendingMediatorParty: "buyer",
        pendingMode: "arbitrate",
      }),
      where: { id: row.id, pendingTransactionJson: null },
    });
  });

  it("returns frozen phase and the 30-day fallback only after UTXO age", async () => {
    const row = { ...joinedRow(), freezeTxId: "dd".repeat(32), status: "freeze_submitted" };
    mocks.db.mediatedEscrowPrototype.findUnique.mockResolvedValue(row);
    mocks.utxos.mockImplementation(async (fundingAddress: string) =>
      fundingAddress === row.frozenFundingAddress ? [frozenUtxo] : [],
    );
    mocks.chain.mockResolvedValue({
      blueScore: 600_000_000n + MEDIATED_ESCROW_FALLBACK_DAA - 1n,
      daa: 600_000_000n + MEDIATED_ESCROW_FALLBACK_DAA - 1n,
    });
    const early = await GET(
      new Request(`https://kaspalinks.com/api/mediated-escrows/${publicId}`),
      context,
    );
    expect(await early.json()).toMatchObject({
      escrow: { fallbackAvailable: false, phase: "frozen" },
    });
  });
});
