import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToccataBatchAllocatorLabScript } from "@/lib/toccata-lab";
import { resetRateLimits } from "@/lib/rate-limit";

const { mockIndexer, mockPrisma, mockRequireCreator } = vi.hoisted(() => ({
  mockIndexer: { findTransactionPayment: vi.fn() },
  mockPrisma: {
    $transaction: vi.fn(),
    claimableBatch: { findUnique: vi.fn(), update: vi.fn() },
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

import { POST } from "./route";

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

function safeJson(secondAmount = "100000000") {
  return JSON.stringify({
    id: TRANSACTION_ID,
    inputs: [
      {
        computeBudget: 30,
        index: 0,
        sequence: "0",
        sigOpCount: 0,
        signatureScript: `41${"11".repeat(65)}51${pushData(ALLOCATOR.redeemScriptHex)}`,
        transactionId: FUNDING_TX_ID,
        utxo: { amount: "201000000" },
      },
    ],
    lockTime: "0",
    outputs: [
      { scriptPublicKey: "0000aa", value: "100000000" },
      { scriptPublicKey: "0000bb", value: secondAmount },
    ],
    subnetworkId: "0".repeat(40),
    version: 1,
  });
}

function request(transactionSafeJson = safeJson()) {
  return new Request("https://kaspalinks.com/api/toccata-lab/batch-activate", {
    body: JSON.stringify({
      batchKey: BATCH_KEY,
      expectedTransactionId: TRANSACTION_ID,
      transactionSafeJson,
    }),
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.31" },
    method: "POST",
  });
}

describe("POST /api/toccata-lab/batch-activate", () => {
  beforeEach(() => {
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockPrisma.claimableBatch.findUnique.mockResolvedValue({
      activationPublicKey: ACTIVATION_PUBLIC_KEY,
      activationTxId: null,
      batchKey: BATCH_KEY,
      createdAt: new Date(0),
      expectedOutputs: OUTPUTS,
      fundingAddress: ALLOCATOR.fundingAddress,
      fundingAmountSompi: 201_000_000n,
      fundingOutputIndex: 0,
      fundingTxId: FUNDING_TX_ID,
      id: "batch-db-1",
      redeemScriptHex: ALLOCATOR.redeemScriptHex,
      refundLockTime: REFUND_LOCK_TIME,
      refundPublicKey: REFUND_PUBLIC_KEY,
      status: "funded",
    });
    mockPrisma.claimableBatch.update.mockResolvedValue({});
    mockPrisma.claimableLink.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockResolvedValue([]);
    mockIndexer.findTransactionPayment.mockResolvedValue({ outputIndex: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimits();
  });

  it("rejects a changed committed output before contacting the relay", async () => {
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("TOCCATA_BATCH_LAB_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request(safeJson("99999999")));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPrisma.claimableBatch.update).not.toHaveBeenCalled();
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
