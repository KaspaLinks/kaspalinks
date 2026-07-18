import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToccataBatchAllocatorLabScript } from "@/lib/toccata-lab";
import { resetRateLimits } from "@/lib/rate-limit";

const { mockIndexer, mockPrisma, mockRequireCreator } = vi.hoisted(() => ({
  mockIndexer: { findTransactionPayment: vi.fn() },
  mockPrisma: {
    $transaction: vi.fn(),
    claimableBatch: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    claimableLink: { updateMany: vi.fn() },
  },
  mockRequireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  prisma: mockPrisma,
}));
vi.mock("@kaspa-actions/kaspa-indexer", () => ({ createRestKaspaIndexer: () => mockIndexer }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn() }));

import { GET, POST } from "./route";

const BATCH_KEY = "batch-test";
const TRANSACTION_ID = "d".repeat(64);
const FUNDING_TX_ID = "a".repeat(64);
const REFUND_LOCK_TIME = "500000000";
const ACTIVATION_PUBLIC_KEY = "bb14a257083f78158e5f69ab772e4608353a7f102198ebf8d85cc98326e29e72";
const REFUND_PUBLIC_KEY = "1730fc2b967d30f6854d7e7e45b70f63153c51c46f2048a92b45fdd74be5bb8c";
const OUTPUTS = [
  { amountSompi: "100000000", linkKey: "batch-test-01", scriptPublicKeyHex: "0000aa" },
  { amountSompi: "100000000", linkKey: "batch-test-02", scriptPublicKeyHex: "0000bb" },
];
const ALLOCATOR = createToccataBatchAllocatorLabScript({
  activationPublicKey: ACTIVATION_PUBLIC_KEY,
  outputs: OUTPUTS,
  refundLockTime: REFUND_LOCK_TIME,
  refundPublicKey: REFUND_PUBLIC_KEY,
});
const SAFE_JSON = JSON.stringify({
  id: TRANSACTION_ID,
  inputs: [
    {
      computeBudget: 30,
      index: 0,
      sequence: "0",
      sigOpCount: 0,
      signatureScript: `41${"11".repeat(65)}00${pushData(ALLOCATOR.redeemScriptHex)}`,
      transactionId: FUNDING_TX_ID,
      utxo: { amount: "201000000" },
    },
  ],
  lockTime: REFUND_LOCK_TIME,
  outputs: [{ scriptPublicKey: `0000${"aa".repeat(34)}`, value: "200000000" }],
  subnetworkId: "0".repeat(40),
  version: 1,
});
const MISMATCH_SAFE_JSON = JSON.stringify({
  ...JSON.parse(SAFE_JSON),
  inputs: [
    {
      ...JSON.parse(SAFE_JSON).inputs[0],
      utxo: { amount: "200000000" },
    },
  ],
  outputs: [{ scriptPublicKey: `0000${"aa".repeat(34)}`, value: "199000000" }],
});

function request(transactionSafeJson = SAFE_JSON) {
  return new Request("https://kaspalinks.com/api/toccata-lab/batch-refund", {
    body: JSON.stringify({
      batchKey: BATCH_KEY,
      expectedTransactionId: TRANSACTION_ID,
      refundLockTime: REFUND_LOCK_TIME,
      transactionSafeJson,
    }),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.30" },
    method: "POST",
  });
}

function registeredBatch() {
  return {
    activationFeeSompi: 1_000_000n,
    activationPublicKey: ACTIVATION_PUBLIC_KEY,
    activationTxId: null,
    createdAt: new Date(0),
    expectedOutputs: OUTPUTS,
    fundingAddress: ALLOCATOR.fundingAddress,
    fundingAmountSompi: 201_000_000n,
    fundingOutputIndex: 0,
    fundingTxId: FUNDING_TX_ID,
    id: "batch-db-1",
    pendingActivationTxId: null,
    pendingRefundTxId: null,
    redeemScriptHex: ALLOCATOR.redeemScriptHex,
    refundLockTime: REFUND_LOCK_TIME,
    refundPublicKey: REFUND_PUBLIC_KEY,
    refundTxId: null,
    status: "funded",
    batchKey: BATCH_KEY,
  };
}

describe("POST /api/toccata-lab/batch-refund", () => {
  beforeEach(() => {
    mockPrisma.claimableBatch.findUnique.mockReset();
    mockPrisma.claimableBatch.update.mockReset();
    mockPrisma.claimableBatch.updateMany.mockReset();
    mockPrisma.claimableLink.updateMany.mockReset();
    mockPrisma.$transaction.mockReset();
    mockIndexer.findTransactionPayment.mockReset();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockPrisma.claimableBatch.findUnique.mockResolvedValue(registeredBatch());
    mockPrisma.claimableBatch.update.mockResolvedValue(registeredBatch());
    mockPrisma.claimableBatch.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.claimableLink.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockResolvedValue([]);
    mockIndexer.findTransactionPayment.mockResolvedValue({
      matchedSompi: 201_000_000n,
      outputIndex: 0,
      transactionId: FUNDING_TX_ID,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimits();
  });

  it("is disabled unless the separate batch lab flag is enabled", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    expect((await POST(request())).status).toBe(403);
  });

  it("relays only a signed refund bound to the creator's expired batch", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_BATCH_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ networkName: "kaspa-mainnet", virtualDaaScore: REFUND_LOCK_TIME }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              localTransactionId: TRANSACTION_ID,
              submittedTransactionId: TRANSACTION_ID,
            }),
            { status: 200 },
          ),
        ),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      broadcast: { submittedTransactionId: TRANSACTION_ID },
    });
    expect(mockPrisma.claimableBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pendingRefundTxId: TRANSACTION_ID }),
        where: expect.objectContaining({ activationTxId: null, pendingActivationTxId: null }),
      }),
    );
  });

  it("rejects a refund while batch activation is pending", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_BATCH_LAB_ENABLED", "true");
    mockPrisma.claimableBatch.findUnique.mockResolvedValueOnce({
      ...registeredBatch(),
      pendingActivationTxId: "e".repeat(64),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPrisma.claimableBatch.updateMany).not.toHaveBeenCalled();
  });

  it("recovers a mismatched allocator output without changing an activated batch", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_BATCH_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_WRPC_RELAY_URL", "http://toccata-relay:3010");
    mockPrisma.claimableBatch.findUnique.mockResolvedValue({
      ...registeredBatch(),
      activationTxId: "e".repeat(64),
      status: "activated",
    });
    mockIndexer.findTransactionPayment.mockResolvedValue({
      matchedSompi: 200_000_000n,
      outputIndex: 0,
      transactionId: FUNDING_TX_ID,
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ networkName: "kaspa-mainnet", virtualDaaScore: REFUND_LOCK_TIME }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              localTransactionId: TRANSACTION_ID,
              submittedTransactionId: TRANSACTION_ID,
            }),
            { status: 200 },
          ),
        ),
    );

    const response = await POST(request(MISMATCH_SAFE_JSON));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      broadcast: { submittedTransactionId: TRANSACTION_ID },
      mismatchRecovery: true,
    });
    expect(mockIndexer.findTransactionPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountSompi: 200_000_000n }),
    );
    expect(mockPrisma.claimableBatch.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns JSON for unsupported methods", () => {
    const response = GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });
});

function pushData(hex: string): string {
  const length = hex.length / 2;
  if (length <= 75) return `${length.toString(16).padStart(2, "0")}${hex}`;
  if (length <= 255) return `4c${length.toString(16).padStart(2, "0")}${hex}`;
  return `4d${(length & 0xff).toString(16).padStart(2, "0")}${((length >> 8) & 0xff)
    .toString(16)
    .padStart(2, "0")}${hex}`;
}
