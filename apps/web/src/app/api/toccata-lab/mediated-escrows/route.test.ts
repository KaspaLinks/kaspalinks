import { createRequire } from "node:module";

import { ESCROW_V2_TEMPLATE_HASH } from "@kaspa-actions/kaspa";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  guard: vi.fn(),
  limit: vi.fn(),
  db: {
    mediatedEscrowPrototype: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  prisma: mocks.db,
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: {
    ESCROW_LINK_CREATOR_MUTATION: "mutation",
    ESCROW_PROTOTYPE_ACCESS: "access",
  },
}));

import {
  MEDIATED_ESCROW_AMOUNT_SOMPI,
  MEDIATED_ESCROW_FALLBACK_DAA,
  MEDIATED_ESCROW_FEE_SOMPI,
} from "@/lib/mediated-escrow-v2";
import { GET, POST } from "./route";

const sdk = createRequire(import.meta.url)("kaspa-wasm") as typeof import("kaspa-wasm");
const sellerKey = new sdk.PrivateKey("41".repeat(32));
const sellerPublicKey = sellerKey.toPublicKey().toXOnlyPublicKey().toString();
const sellerAddress = sellerKey.toPublicKey().toAddress("mainnet").toString();

const created = {
  amountSompi: MEDIATED_ESCROW_AMOUNT_SOMPI,
  claimDelayDaa: 6_048_000n,
  contractTemplateHash: ESCROW_V2_TEMPLATE_HASH,
  createdAt: new Date("2026-09-24T12:00:00.000Z"),
  fallbackDelayDaa: MEDIATED_ESCROW_FALLBACK_DAA,
  feeSompi: MEDIATED_ESCROW_FEE_SOMPI,
  mediatorLabel: "Independent reviewer",
  publicId: "cm12345678901234567890124",
  status: "awaiting_mediator",
  title: "Physical item",
};

function request(method = "GET", body?: unknown) {
  return new Request("https://kaspalinks.com/api/toccata-lab/mediated-escrows", {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json" },
    method,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ESCROW_LINKS_PROTOTYPE_ENABLED", "true");
  vi.stubEnv("ESCROW_LINKS_PROTOTYPE_CREATORS", "example");
  mocks.guard.mockResolvedValue({
    creator: { id: "creator-id", username: "example" },
    ipHash: "test-ip",
    ok: true,
  });
  mocks.limit.mockReturnValue({ allowed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  sellerKey.free();
});

describe("creator mediated escrow route", () => {
  it("lists only the authenticated creator's links", async () => {
    mocks.db.mediatedEscrowPrototype.findMany.mockResolvedValue([created]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.db.mediatedEscrowPrototype.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 20,
      where: { creatorId: "creator-id" },
    });
    expect((await response.json()).escrows[0]).toMatchObject({
      publicId: created.publicId,
      sharePath: `/mediated-escrows/${created.publicId}`,
    });
  });

  it("stores only fixed public commitments for a valid seller", async () => {
    mocks.db.mediatedEscrowPrototype.create.mockResolvedValue(created);

    const response = await POST(
      request("POST", {
        claimDelayDaa: "6048000",
        mediatorLabel: created.mediatorLabel,
        sellerAddress,
        sellerPublicKey,
        signerContextId: "escrow-v2-test-context",
        title: created.title,
      }),
    );

    expect(response.status).toBe(201);
    const data = mocks.db.mediatedEscrowPrototype.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      amountSompi: MEDIATED_ESCROW_AMOUNT_SOMPI,
      contractTemplateHash: ESCROW_V2_TEMPLATE_HASH,
      creatorId: "creator-id",
      fallbackDelayDaa: MEDIATED_ESCROW_FALLBACK_DAA,
      feeSompi: MEDIATED_ESCROW_FEE_SOMPI,
      sellerAddress,
      sellerPublicKey,
    });
    expect(Object.keys(data).join(" ")).not.toMatch(/private|prf|seed|recovery/iu);
    expect(mocks.audit).toHaveBeenCalledWith(
      mocks.db,
      expect.objectContaining({ event: "escrow.v2_created" }),
    );
  });

  it("hides the creator endpoint from accounts outside the allowlist", async () => {
    mocks.guard.mockResolvedValue({
      creator: { id: "other-id", username: "other" },
      ipHash: "test-ip",
      ok: true,
    });

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mocks.db.mediatedEscrowPrototype.findMany).not.toHaveBeenCalled();
  });
});
