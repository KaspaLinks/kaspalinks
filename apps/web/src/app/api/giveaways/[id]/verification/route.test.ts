import { beforeEach, describe, expect, it, vi } from "vitest";

const { enforceRateLimitMock, findUniqueMock, restoreMock } = vi.hoisted(() => ({
  enforceRateLimitMock: vi.fn(),
  findUniqueMock: vi.fn(),
  restoreMock: vi.fn(),
}));

vi.mock("@kaspa-actions/application", () => ({
  restoreGiveawayV6Projection: restoreMock,
}));
vi.mock("@kaspa-actions/db", () => ({
  Network: { MAINNET: "MAINNET", TESTNET: "TESTNET" },
  prisma: { giveaway: { findUnique: findUniqueMock } },
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: enforceRateLimitMock,
  RateBuckets: { GIVEAWAY_V6_VERIFICATION: "giveaway-v6.verification" },
}));

import { GET } from "./route";

const PUBLIC_ID = "cm12345678901234567890123";

describe("GET /api/giveaways/[id]/verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceRateLimitMock.mockReturnValue({ allowed: true, result: {} });
  });

  it("returns a chain-derived V6 snapshot and public transition journal", async () => {
    findUniqueMock.mockResolvedValue({
      amountSompi: 100_000_000n,
      publicId: PUBLIC_ID,
      title: "On-chain draw",
      v6Projection: {
        id: "projection-1",
        network: "MAINNET",
        covenantIdHex: "02".repeat(32),
        anchorHash: "01".repeat(32),
        config: {},
        family: {},
        checkpoint: {},
        phase: "OPEN",
        observedRegistrationCount: 1,
        frozenEntryCount: null,
        winnerScriptPublicKeyHex: null,
        terminalTransactionId: null,
        cursorHash: "03".repeat(32),
        lastPageFingerprint: "04".repeat(32),
        syncRevision: 2,
        lastSyncedAt: new Date("2026-10-10T12:00:00.000Z"),
        lastErrorCode: null,
      },
    });
    restoreMock.mockReturnValue({
      config: {
        giveawayIdHex: "05".repeat(32),
        closesAtDaa: 100n,
        returnAtDaa: 200n,
        entropyTargetBlueScore: 150n,
        shardCount: 1,
        treeDepth: 4,
        maxEntriesPerShard: 16,
        returnScriptPublicKeyHex: "000051",
      },
      family: {
        genesisOutpoint: { transactionId: "06".repeat(32), outputIndex: 0 },
        covenantIdHex: "02".repeat(32),
        prizeTemplateHashHex: "07".repeat(32),
        shardTemplateHashHex: "08".repeat(32),
        prizeValueSompi: 100_000_000n,
        shardValueSompi: 10_000n,
        entryFeeSompi: 1_000n,
        activationFeeSompi: 2_000n,
        freezeFeeSompi: 3_000n,
        drawFeeSompi: 4_000n,
        returnFeeSompi: 5_000n,
      },
      checkpoint: {
        schemaVersion: 1,
        network: "mainnet",
        anchorHash: "01".repeat(32),
        cursorHash: "03".repeat(32),
        covenantIdHex: "02".repeat(32),
        lastPageFingerprint: "04".repeat(32),
        transitions: [
          {
            acceptingBlockHash: "09".repeat(32),
            event: {
              kind: "activate",
              transactionId: "0a".repeat(32),
              blockDaaScore: 90n,
              prizeOutputIndex: 0,
              shardOutputIndexes: [1],
            },
          },
        ],
      },
      snapshot: {
        phase: "open",
        activationTransactionId: "0a".repeat(32),
        freezeTransactionId: null,
        terminalTransactionId: null,
        prizeOutpoint: { transactionId: "0a".repeat(32), outputIndex: 0 },
        observedRegistrationCount: 0,
        frozenEntryCount: null,
        frozenRootHex: null,
        shards: [
          {
            shardIndex: 0,
            finalizedEntryCount: 0,
            entriesRootHex: "00".repeat(32),
            addressRootHex: "00".repeat(32),
            finalizedEntries: [],
            pendingEntry: null,
            excludedLateEntry: null,
            tipOutpoint: { transactionId: "0a".repeat(32), outputIndex: 1 },
          },
        ],
        winner: null,
      },
    });

    const response = await GET(new Request(`https://kaspalinks.com/api/giveaways/${PUBLIC_ID}`), {
      params: Promise.resolve({ id: PUBLIC_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      giveaway: { amountSompi: "100000000", publicId: PUBLIC_ID },
      protocol: { version: 6, network: "mainnet" },
      chain: { cursorHash: "03".repeat(32), status: "verified" },
      projection: {
        snapshot: { phase: "open" },
        transitions: [{ acceptingBlockHash: "09".repeat(32) }],
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/privateKey|seedPhrase|witness/i);
  });

  it("returns 404 for a malformed or unprojected giveaway", async () => {
    const malformed = await GET(new Request("https://kaspalinks.com"), {
      params: Promise.resolve({ id: "not-an-id" }),
    });
    expect(malformed.status).toBe(404);
    expect(findUniqueMock).not.toHaveBeenCalled();

    findUniqueMock.mockResolvedValue({ v6Projection: null });
    const missing = await GET(new Request("https://kaspalinks.com"), {
      params: Promise.resolve({ id: PUBLIC_ID }),
    });
    expect(missing.status).toBe(404);
  });
});
