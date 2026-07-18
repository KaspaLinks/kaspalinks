import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createToccataBatchAllocatorLabScript,
  createToccataClaimableLabScript,
} from "@/lib/toccata-lab";
import { deriveToccataLabKeyPair } from "@/lib/toccata-lab-keys";
import { resetRateLimits } from "@/lib/rate-limit";

const { mockPrisma, mockRequireCreator } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(),
    claimableBatch: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    claimableLink: { findMany: vi.fn(), updateMany: vi.fn() },
  },
  mockRequireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  Network: { MAINNET: "MAINNET" },
  Prisma: {},
  prisma: mockPrisma,
}));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));

import { GET, POST } from "./route";

const REFUND_LOCK_TIME = "500000000";
const activation = deriveToccataLabKeyPair("1".padStart(64, "0"));
const batchRefund = deriveToccataLabKeyPair("2".padStart(64, "0"));
const children = [3, 5].map((base, index) => {
  const claim = deriveToccataLabKeyPair(String(base).padStart(64, "0"));
  const refund = deriveToccataLabKeyPair(String(base + 1).padStart(64, "0"));
  const script = createToccataClaimableLabScript({
    linkPublicKey: claim.xOnlyPublicKey,
    refundLockTime: REFUND_LOCK_TIME,
    refundPublicKey: refund.xOnlyPublicKey,
  });
  return { claim, index, refund, script };
});
const outputs = children.map((child) => ({
  amountSompi: "100000000",
  linkKey: `batch-test-0${child.index + 1}`,
  scriptPublicKeyHex: serializeScriptPublicKey(child.script.scriptPublicKey),
}));
const allocator = createToccataBatchAllocatorLabScript({
  activationPublicKey: activation.xOnlyPublicKey,
  outputs,
  refundLockTime: REFUND_LOCK_TIME,
  refundPublicKey: batchRefund.xOnlyPublicKey,
});

function request(overrides: Record<string, unknown> = {}) {
  return new Request("https://kaspalinks.com/api/creator/claimable-batches", {
    body: JSON.stringify({
      activationFeeSompi: "1000000",
      activationPublicKey: activation.xOnlyPublicKey,
      batchKey: "batch-test",
      fundingAddress: allocator.fundingAddress,
      fundingAmountSompi: "201000000",
      outputs,
      redeemScriptHex: allocator.redeemScriptHex,
      refundLockTime: REFUND_LOCK_TIME,
      refundPublicKey: batchRefund.xOnlyPublicKey,
      title: "Test batch",
      ...overrides,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

describe("POST /api/creator/claimable-batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockPrisma.claimableBatch.findUnique.mockResolvedValue(null);
    mockPrisma.claimableLink.findMany.mockResolvedValue(
      children.map((child) => ({
        amountSompi: 100_000_000n,
        claimPublicKey: child.claim.xOnlyPublicKey,
        creatorId: "creator-1",
        deletedAt: null,
        linkKey: outputs[child.index]!.linkKey,
        redeemScriptHex: child.script.redeemScriptHex,
        refundLockTime: REFUND_LOCK_TIME,
        refundPublicKey: child.refund.xOnlyPublicKey,
      })),
    );
    mockPrisma.claimableBatch.create.mockImplementation(({ data }) =>
      Promise.resolve({ ...data, batchKey: "batch-test", status: "awaiting_funding" }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimits();
  });

  it("registers only canonical public contract metadata", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockPrisma.claimableBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          activationPublicKey: activation.xOnlyPublicKey,
          creatorId: "creator-1",
          fundingAddress: allocator.fundingAddress,
        }),
      }),
    );
    const persisted = JSON.stringify(mockPrisma.claimableBatch.create.mock.calls, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(persisted).not.toContain(activation.privateKey);
  });

  it("rejects a manifest whose funding address was changed", async () => {
    const response = await POST(
      request({
        fundingAddress: "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j",
      }),
    );

    expect(response.status).toBe(400);
    expect(mockPrisma.claimableBatch.create).not.toHaveBeenCalled();
  });

  it("treats a concurrent registration of the same public manifest as idempotent", async () => {
    const existing = {
      activationFeeSompi: 1_000_000n,
      activationPublicKey: activation.xOnlyPublicKey,
      batchKey: "batch-test",
      creatorId: "creator-1",
      expectedOutputs: outputs,
      fundingAddress: allocator.fundingAddress,
      fundingAmountSompi: 201_000_000n,
      redeemScriptHex: allocator.redeemScriptHex,
      refundLockTime: REFUND_LOCK_TIME,
      refundPublicKey: batchRefund.xOnlyPublicKey,
      status: "awaiting_funding",
      title: "Test batch",
    };
    mockPrisma.claimableBatch.create.mockRejectedValueOnce({
      code: "P2002",
      meta: { target: ["batchKey"] },
    });
    mockPrisma.claimableBatch.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimableBatch: { batchKey: "batch-test", status: "awaiting_funding" },
    });
  });
});

describe("GET /api/creator/claimable-batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockPrisma.$transaction.mockResolvedValue([]);
    mockPrisma.claimableBatch.update.mockResolvedValue({});
    mockPrisma.claimableLink.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reconciles an accepted refund even if a stale activation transition is also pending", async () => {
    const pendingActivationTxId = "a".repeat(64);
    const pendingRefundTxId = "b".repeat(64);
    const baseBatch = {
      activationTxId: null,
      batchKey: "batch-test",
      expectedOutputs: outputs,
      fundingOutputIndex: 0,
      fundingTxId: "c".repeat(64),
      id: "batch-db-1",
      pendingActivationTxId,
      pendingRefundTxId,
      refundTxId: null,
      status: "funded",
    };
    mockPrisma.claimableBatch.findUnique.mockResolvedValueOnce(baseBatch).mockResolvedValueOnce({
      ...baseBatch,
      pendingActivationTxId: null,
      pendingRefundTxId: null,
      refundTxId: pendingRefundTxId,
      status: "refunded",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ is_accepted: true, transaction_id: pendingRefundTxId }), {
            status: 200,
          }),
        ),
    );

    const response = await GET(
      new Request("https://kaspalinks.com/api/creator/claimable-batches?batchKey=batch-test"),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      claimableBatch: { refundTxId: pendingRefundTxId, status: "refunded" },
    });
  });
});

function serializeScriptPublicKey(value: { script: string; version: number }): string {
  return value.version.toString(16).padStart(4, "0") + value.script.toLowerCase();
}
