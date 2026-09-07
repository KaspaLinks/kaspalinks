import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  limit: vi.fn(),
  audit: vi.fn(),
  reconcile: vi.fn(),
  db: { giveaway: { findMany: vi.fn(), create: vi.fn() }, claimableLink: { findUnique: vi.fn() } },
}));
vi.mock("@kaspa-actions/db", () => ({
  prisma: mocks.db,
  AuditActorType: { CREATOR: "CREATOR" },
  GiveawayStatus: { OPEN: "OPEN", DRAWN: "DRAWN", NO_ENTRIES: "NO_ENTRIES" },
}));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.guard }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: mocks.limit,
  RateBuckets: { TOCCATA_LAB_GIVEAWAY_MUTATION: "test" },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/giveaway-prize", () => ({ reconcileGiveawayPrize: mocks.reconcile }));
import { GET, POST } from "./route";

describe("giveaway setup timing metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TOCCATA_LAB_ENABLED", "true");
    vi.stubEnv("GIVEAWAY_LAB_ENABLED", "true");
    mocks.guard.mockResolvedValue({ ok: true, creator: { id: "creator" }, ipHash: "test" });
    mocks.limit.mockReturnValue({ allowed: true });
    mocks.reconcile.mockImplementation((value) => value);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const createdAt = new Date("2026-09-07T12:00:00Z");
  const prizeCreatedAt = new Date("2026-09-07T11:50:00Z");
  const prize = {
    amountSompi: 1000200000n,
    feeSompi: 200000n,
    createdAt: prizeCreatedAt,
    creatorId: "creator",
    deletedAt: null,
    prizeForGiveaway: null,
    status: "awaiting_funding",
    fundingTxId: null,
    linkKey: "prize",
  };
  const giveaway = {
    publicId: "giveaway",
    createdAt,
    closesAt: new Date("2026-09-08T12:00:00Z"),
    openedAt: null,
    status: "OPEN",
    amountSompi: 1000000000n,
    description: null,
    title: "Community",
    entryWindowSeconds: 86400,
    prizeLink: prize,
    _count: { entries: 0 },
  };
  it("returns the contract deadline in creator listings", async () => {
    mocks.db.giveaway.findMany.mockResolvedValue([giveaway]);
    const response = await GET(new Request("https://example.com/api/toccata-lab/giveaways"));
    const body = await response.json();
    expect(body.giveaways[0]).toMatchObject({
      createdAt: createdAt.toISOString(),
      entryWindowSeconds: 86400,
      fundingExpiresAt: "2026-09-07T12:50:00.000Z",
    });
  });
  it("returns timing immediately on creation so funding needs no preliminary poll", async () => {
    mocks.db.claimableLink.findUnique.mockResolvedValue(prize);
    mocks.db.giveaway.create.mockResolvedValue(giveaway);
    const response = await POST(
      new Request("https://example.com/api/toccata-lab/giveaways", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Community",
          amountKas: "10",
          closesAt: new Date(Date.now() + 3600000).toISOString(),
          prizeLinkKey: "prize",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect((await response.json()).giveaway).toMatchObject({
      createdAt: createdAt.toISOString(),
      fundingExpiresAt: "2026-09-07T12:50:00.000Z",
      status: "PENDING_FUNDING",
    });
  });
});
