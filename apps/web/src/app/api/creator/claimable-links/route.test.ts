import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnforceRateLimit,
  mockIndexer,
  mockPrisma,
  mockReadCreatorActionDailyLimit,
  mockRequireCreator,
  mockResolveClaimableOnChain,
  mockRollingDailyWindowStart,
  mockWriteAuditLog,
} = vi.hoisted(() => ({
  mockEnforceRateLimit: vi.fn(),
  mockIndexer: { findTransactionPayment: vi.fn() },
  mockPrisma: {
    action: { count: vi.fn() },
    claimableLink: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockReadCreatorActionDailyLimit: vi.fn(),
  mockRequireCreator: vi.fn(),
  mockResolveClaimableOnChain: vi.fn(),
  mockRollingDailyWindowStart: vi.fn(),
  mockWriteAuditLog: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  Network: { MAINNET: "MAINNET" },
  prisma: mockPrisma,
}));
vi.mock("@kaspa-actions/kaspa-indexer", () => ({ createRestKaspaIndexer: () => mockIndexer }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mockWriteAuditLog }));
vi.mock("@/lib/creator-auth", () => ({
  readCreatorActionDailyLimit: mockReadCreatorActionDailyLimit,
  rollingDailyWindowStart: mockRollingDailyWindowStart,
}));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mockRequireCreator }));
vi.mock("@/lib/claimable-onchain", () => ({
  resolveClaimableOnChain: mockResolveClaimableOnChain,
}));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mockEnforceRateLimit,
  RateBuckets: {
    CREATOR_ACTION_CREATE: "creator.action.create",
    CREATOR_PROFILE_UPDATE: "creator.profile.update",
  },
}));

import { DELETE, GET, PATCH, POST } from "./route";

const CREATED_AT = new Date("2026-07-10T12:00:00.000Z");
const CLAIM_PUBLIC_KEY = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
const REFUND_PUBLIC_KEY = "466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27";
const FUNDING_ADDRESS = "kaspa:ppkr0dzfr3ptks6w0238uzqrqr98h07a3rrplzlwdmau3hapzjma6qe42a2vh";
const OTHER_FUNDING_ADDRESS = "kaspa:pqtvlcvulje439t7dankkw56m2z75zhjqrwkrqf6qnlgrsuwy8ahxgf55x7hg";
const REDEEM_SCRIPT_HEX =
  "63204f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aaac67b5040065cd1da26920466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27ac68";

function request(body: unknown) {
  return new Request("https://kaspalinks.com/api/creator/claimable-links", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function deleteRequest(linkKey = "lab-safe-link") {
  return new Request(
    `https://kaspalinks.com/api/creator/claimable-links?linkKey=${encodeURIComponent(linkKey)}`,
    { method: "DELETE" },
  );
}

function patchRequest(body: unknown) {
  return new Request("https://kaspalinks.com/api/creator/claimable-links", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    amountSompi: "100000000",
    claimPublicKey: CLAIM_PUBLIC_KEY,
    description: "A reward",
    feeSompi: "200000",
    fundingAddress: FUNDING_ADDRESS,
    linkKey: "lab-safe-link",
    redeemScriptHex: REDEEM_SCRIPT_HEX,
    refundLockTime: "500000000",
    refundPublicKey: REFUND_PUBLIC_KEY,
    title: "Claim this",
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    amountSompi: 100_000_000n,
    claimPublicKey: CLAIM_PUBLIC_KEY,
    claimTxId: null,
    claimedAt: null,
    createdAt: CREATED_AT,
    creatorId: "creator-1",
    deletedAt: null,
    description: "A reward",
    feeSompi: 200_000n,
    fundingAddress: FUNDING_ADDRESS,
    fundingOutputIndex: null,
    fundingTxId: null,
    id: "claimable-1",
    linkKey: "lab-safe-link",
    network: "MAINNET",
    redeemScriptHex: REDEEM_SCRIPT_HEX,
    refundLockTime: "500000000",
    refundPublicKey: REFUND_PUBLIC_KEY,
    refundTxId: null,
    refundedAt: null,
    status: "awaiting_funding",
    title: "Claim this",
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

describe("creator claimable link API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip-hash",
      ok: true,
    });
    mockEnforceRateLimit.mockReturnValue({ allowed: true, result: {} });
    mockReadCreatorActionDailyLimit.mockReturnValue(50);
    mockRollingDailyWindowStart.mockReturnValue(new Date("2026-07-09T12:00:00.000Z"));
    mockPrisma.claimableLink.findUnique.mockResolvedValue(null);
    mockPrisma.claimableLink.findMany.mockResolvedValue([]);
    mockPrisma.claimableLink.count.mockResolvedValue(0);
    mockPrisma.action.count.mockResolvedValue(0);
    mockPrisma.claimableLink.create.mockImplementation(async ({ data }) => row(data));
    mockPrisma.claimableLink.update.mockImplementation(async ({ data }) => row(data));
    mockPrisma.claimableLink.updateMany.mockResolvedValue({ count: 1 });
    mockIndexer.findTransactionPayment.mockResolvedValue(null);
    mockResolveClaimableOnChain.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates only an awaiting-funding record and ignores client status claims", async () => {
    const response = await POST(
      request(
        payload({
          fundingOutputIndex: 9,
          fundingTxId: "c".repeat(64),
          status: "claimed",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.claimableLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creatorId: "creator-1",
        status: "awaiting_funding",
      }),
    });
    const createData = mockPrisma.claimableLink.create.mock.calls[0]?.[0]?.data;
    expect(createData).not.toHaveProperty("fundingTxId");
    expect(createData).not.toHaveProperty("fundingOutputIndex");
  });

  it("does not return claimable links removed from My Links", async () => {
    const response = await GET(new Request("https://kaspalinks.com/api/creator/claimable-links"));

    expect(response.status).toBe(200);
    expect(mockPrisma.claimableLink.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 200,
      where: { creatorId: "creator-1", deletedAt: null },
    });
  });

  it("returns terminal transaction details for creator activity", async () => {
    const claimedAt = new Date("2026-07-10T12:05:00.000Z");
    mockPrisma.claimableLink.findMany.mockResolvedValue([
      row({
        claimedAt,
        claimTxId: "a".repeat(64),
        status: "claimed",
      }),
    ]);

    const response = await GET(new Request("https://kaspalinks.com/api/creator/claimable-links"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.claimableLinks[0]).toMatchObject({
      claimedAt: claimedAt.toISOString(),
      claimTxId: "a".repeat(64),
      refundedAt: null,
      refundTxId: null,
      status: "claimed",
    });
  });

  it.each([
    ["a mismatched funding address", { fundingAddress: OTHER_FUNDING_ADDRESS }],
    ["a mismatched redeem script", { redeemScriptHex: `${REDEEM_SCRIPT_HEX.slice(0, -2)}00` }],
    ["a malformed claim public key", { claimPublicKey: "ab" }],
    ["an amount below 1 KAS", { amountSompi: "99999999" }],
    ["a fee equal to the amount", { feeSompi: "100000000" }],
    ["an output below the reliable minimum", { feeSompi: "85000000" }],
  ])("rejects %s", async (_label, overrides) => {
    const response = await POST(request(payload(overrides)));

    expect(response.status).toBe(400);
    expect(mockPrisma.claimableLink.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of a link key with different immutable metadata", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(row());

    const response = await POST(request(payload({ title: "Changed title" })));

    expect(response.status).toBe(409);
    expect(mockPrisma.claimableLink.create).not.toHaveBeenCalled();
  });

  it("enforces the combined daily regular and claimable link cap", async () => {
    mockPrisma.claimableLink.count.mockResolvedValue(25);
    mockPrisma.action.count.mockResolvedValue(25);

    const response = await POST(request(payload()));

    expect(response.status).toBe(429);
    expect(mockPrisma.claimableLink.create).not.toHaveBeenCalled();
  });

  it("rejects arbitrary client-controlled status PATCH data", async () => {
    const response = await PATCH(patchRequest({ linkKey: "lab-safe-link", status: "claimed" }));

    expect(response.status).toBe(400);
    expect(mockPrisma.claimableLink.updateMany).not.toHaveBeenCalled();
  });

  it("adopts one verified unspent amount without receiving any private code", async () => {
    const fundingTxId = "c".repeat(64);
    mockPrisma.claimableLink.findUnique.mockResolvedValue(row());
    mockIndexer.findTransactionPayment.mockResolvedValue({
      matchedSompi: 120_000_000n,
      outputIndex: 1,
      transactionId: fundingTxId,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              outpoint: { index: 1, transactionId: fundingTxId },
              utxoEntry: { amount: "120000000" },
            },
          ]),
          { status: 200 },
        ),
      ),
    );

    const response = await PATCH(
      patchRequest({
        amountSompi: "120000000",
        fundingOutputIndex: 1,
        fundingTransactionId: fundingTxId,
        linkKey: "lab-safe-link",
      }),
    );

    expect(response.status).toBe(200);
    expect(mockPrisma.claimableLink.updateMany).toHaveBeenCalledWith({
      data: {
        amountSompi: 120_000_000n,
        fundingOutputIndex: 1,
        fundingTxId,
        status: "funded",
      },
      where: {
        creatorId: "creator-1",
        deletedAt: null,
        fundingTxId: null,
        id: "claimable-1",
        status: "awaiting_funding",
      },
    });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ event: "claimable_link.funding_amount_adopted" }),
    );
  });

  it("hides an awaiting-funding link only after verifying that it is unfunded", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(row());

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mockResolveClaimableOnChain).toHaveBeenCalledWith(
      expect.objectContaining({
        amountSompi: "100000000",
        fundingAddress: expect.stringMatching(/^kaspa:/),
        status: "awaiting_funding",
      }),
    );
    expect(mockPrisma.claimableLink.update).toHaveBeenCalledWith({
      data: { deletedAt: expect.any(Date) },
      where: { id: "claimable-1" },
    });
  });

  it("keeps an awaiting-funding link when funding is detected during deletion", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(row());
    mockResolveClaimableOnChain.mockResolvedValue({
      fundingOutputIndex: 0,
      fundingTxId: "c".repeat(64),
      status: "funded",
    });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(409);
    expect(mockPrisma.claimableLink.update).toHaveBeenCalledWith({
      data: {
        fundingOutputIndex: 0,
        fundingTxId: "c".repeat(64),
        status: "funded",
      },
      where: { id: "claimable-1" },
    });
    expect(mockPrisma.claimableLink.update).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the unfunded check is unavailable", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(row());
    mockResolveClaimableOnChain.mockRejectedValue(new Error("indexer unavailable"));

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    expect(mockPrisma.claimableLink.update).not.toHaveBeenCalled();
  });

  it("does not delete a funded claimable link that remains unspent", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(
      row({ fundingOutputIndex: 0, fundingTxId: "c".repeat(64), status: "funded" }),
    );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(409);
    expect(mockResolveClaimableOnChain).toHaveBeenCalledWith(
      expect.objectContaining({ status: "funded" }),
    );
    expect(mockPrisma.claimableLink.update).not.toHaveBeenCalled();
  });

  it("reconciles an on-chain refund before deleting a stale expired link", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(
      row({
        fundingOutputIndex: 0,
        fundingTxId: "c".repeat(64),
        refundTxId: "d".repeat(64),
        status: "refundable",
      }),
    );
    mockResolveClaimableOnChain.mockResolvedValue({ status: "refunded" });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mockPrisma.claimableLink.update).toHaveBeenNthCalledWith(1, {
      data: { status: "refunded" },
      where: { id: "claimable-1" },
    });
    expect(mockPrisma.claimableLink.update).toHaveBeenNthCalledWith(2, {
      data: { deletedAt: expect.any(Date) },
      where: { id: "claimable-1" },
    });
  });

  it("soft-deletes a closed claimable link so historical stats remain stable", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(row({ status: "claimed" }));

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mockPrisma.claimableLink.update).toHaveBeenCalledWith({
      data: { deletedAt: expect.any(Date) },
      where: { id: "claimable-1" },
    });
  });
});
