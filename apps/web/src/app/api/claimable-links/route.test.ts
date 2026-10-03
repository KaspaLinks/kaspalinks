import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockWriteAuditLog } = vi.hoisted(() => ({
  mockPrisma: {
    claimableLink: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
  mockWriteAuditLog: vi.fn(async () => {}),
}));

vi.mock("@kaspa-actions/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kaspa-actions/db")>()),
  AuditActorType: { PUBLIC: "PUBLIC" },
  prisma: mockPrisma,
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mockWriteAuditLog }));

vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: {
    CLAIMABLE_ANONYMOUS_CREATE: "claimable.anonymous-create",
    CLAIMABLE_ANONYMOUS_DAILY: "claimable.anonymous-daily",
  },
}));

import { createToccataClaimableAutoReturnScript } from "@/lib/toccata-lab";

import { POST } from "./route";

const CLAIM_PUBLIC_KEY = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
const RETURN_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
const script = createToccataClaimableAutoReturnScript({
  feeSompi: "200000",
  linkPublicKey: CLAIM_PUBLIC_KEY,
  refundLockTime: "500000000",
  returnAddress: RETURN_ADDRESS,
});

const body = {
  amountSompi: "100200000",
  claimPublicKey: CLAIM_PUBLIC_KEY,
  feeSompi: "200000",
  fundingAddress: script.fundingAddress,
  linkKey: "lab-abc123",
  redeemScriptHex: script.redeemScriptHex,
  refundLockTime: "500000000",
  returnAddress: RETURN_ADDRESS,
  scriptVersion: 2,
  source: "claim-success",
  title: "Coffee for Ada",
};

function request(payload: unknown) {
  return new Request("https://example.com/api/claimable-links", {
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function storedRow(data: Record<string, unknown>) {
  return {
    claimTxId: null,
    claimedAt: null,
    createdAt: new Date("2026-10-04T10:00:00.000Z"),
    deletedAt: null,
    fundingOutputIndex: null,
    fundingTxId: null,
    id: "row-1",
    refundTxId: null,
    refundedAt: null,
    updatedAt: new Date("2026-10-04T10:00:00.000Z"),
    ...data,
  };
}

describe("POST /api/claimable-links (account-free)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("CLAIMABLE_AUTO_RETURN_ENABLED", "true");
    vi.stubEnv("CLAIMABLE_ANONYMOUS_ENABLED", "true");
    mockPrisma.claimableLink.findUnique.mockResolvedValue(null);
    mockPrisma.claimableLink.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => storedRow(data),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is hidden while account-free links are switched off", async () => {
    vi.stubEnv("CLAIMABLE_ANONYMOUS_ENABLED", "false");
    const response = await POST(request(body));
    expect(response.status).toBe(404);
    expect(mockPrisma.claimableLink.create).not.toHaveBeenCalled();
  });

  it("registers a v2 link without a creator and keeps only the allowlisted label", async () => {
    const response = await POST(request(body));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(mockPrisma.claimableLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        creatorId: null,
        linkKey: "lab-abc123",
        refundPublicKey: null,
        returnAddress: RETURN_ADDRESS,
        scriptVersion: 2,
        source: "claim-success",
        status: "awaiting_funding",
      }),
    });
    const stored = mockPrisma.claimableLink.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(stored).not.toHaveProperty("ipHash");
    expect(stored).not.toHaveProperty("createdIpHash");
    expect(json.claimableLink).toMatchObject({ linkKey: "lab-abc123", scriptVersion: 2 });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      mockPrisma,
      expect.objectContaining({ event: "claimable_link.created_anonymous" }),
    );
  });

  it("drops unknown labels and refuses classic links without an account", async () => {
    await POST(request({ ...body, source: "tracking-id-123" }));
    expect(mockPrisma.claimableLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: null }),
    });

    const classic = await POST(
      request({ ...body, refundPublicKey: "1".repeat(64), scriptVersion: 1 }),
    );
    expect(classic.status).toBe(400);
  });

  it("answers an identical retry idempotently and rejects a hijack of a creator link", async () => {
    mockPrisma.claimableLink.findUnique.mockResolvedValue(
      storedRow({
        amountSompi: 100_200_000n,
        claimPublicKey: CLAIM_PUBLIC_KEY,
        creatorId: null,
        description: null,
        feeSompi: 200_000n,
        fundingAddress: script.fundingAddress,
        linkKey: "lab-abc123",
        network: "MAINNET",
        redeemScriptHex: script.redeemScriptHex,
        refundLockTime: "500000000",
        refundPublicKey: null,
        returnAddress: RETURN_ADDRESS,
        scriptVersion: 2,
        status: "awaiting_funding",
        title: "Coffee for Ada",
      }),
    );
    const retry = await POST(request(body));
    expect(retry.status).toBe(200);

    mockPrisma.claimableLink.findUnique.mockResolvedValue(
      storedRow({ creatorId: "creator-1", linkKey: "lab-abc123" }),
    );
    const hijack = await POST(request(body));
    expect(hijack.status).toBe(409);
  });
});
