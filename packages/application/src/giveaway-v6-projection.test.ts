import { GiveawayV6Phase, Network, type PrismaClient } from "@kaspa-actions/db";
import type {
  GiveawayV6ProjectionCheckpoint,
  GiveawayV6ReconstructionConfig,
} from "@kaspa-actions/kaspa-indexer";
import { describe, expect, it, vi } from "vitest";

import {
  buildGiveawayV6ProjectionCreateData,
  persistGiveawayV6ProjectionAdvance,
  prepareGiveawayV6ProjectionAdvance,
  restoreGiveawayV6Projection,
  type GiveawayV6ProjectionRecord,
} from "./giveaway-v6-projection";

const HASH = {
  anchor: "01".repeat(32),
  covenant: "02".repeat(32),
  giveaway: "03".repeat(32),
  genesis: "04".repeat(32),
  prize: "05".repeat(32),
  shard: "06".repeat(32),
};

const config: GiveawayV6ReconstructionConfig = {
  giveawayIdHex: HASH.giveaway,
  closesAtDaa: 100n,
  returnAtDaa: 200n,
  entropyTargetBlueScore: 150n,
  shardCount: 1,
  treeDepth: 4,
  maxEntriesPerShard: 16,
  returnScriptPublicKeyHex: "000051",
};

const family = {
  genesisOutpoint: { transactionId: HASH.genesis, outputIndex: 0 },
  covenantIdHex: HASH.covenant,
  prizeTemplateHashHex: HASH.prize,
  shardTemplateHashHex: HASH.shard,
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 30_000n,
  entryFeeSompi: 1_000n,
  activationFeeSompi: 2_000n,
  freezeFeeSompi: 3_000n,
  drawFeeSompi: 4_000n,
  returnFeeSompi: 5_000n,
};

function emptyRecord(): GiveawayV6ProjectionRecord {
  const data = buildGiveawayV6ProjectionCreateData({
    network: Network.MAINNET,
    anchorHash: HASH.anchor,
    config,
    family,
  });
  return {
    id: "projection-1",
    ...data,
    checkpoint: null,
    syncRevision: 7,
  };
}

describe("Giveaway V6 projection persistence", () => {
  it("builds a JSON-safe empty projection containing public values only", () => {
    const data = buildGiveawayV6ProjectionCreateData({
      network: Network.MAINNET,
      anchorHash: HASH.anchor.toUpperCase(),
      config,
      family,
    });

    expect(data).toMatchObject({
      anchorHash: HASH.anchor,
      covenantIdHex: HASH.covenant,
      phase: GiveawayV6Phase.AWAITING_ACTIVATION,
      observedRegistrationCount: 0,
    });
    expect(JSON.stringify(data)).not.toMatch(/privateKey|seedPhrase|witness/i);
    expect(data.config).toMatchObject({ closesAtDaa: "100" });
    expect(data.family).toMatchObject({ prizeValueSompi: "100000000" });
  });

  it("rejects a checkpoint whose indexed cursor was altered", () => {
    const record = emptyRecord();
    record.checkpoint = checkpoint();
    record.cursorHash = "ff".repeat(32);
    record.lastPageFingerprint = "08".repeat(32);

    expect(() => restoreGiveawayV6Projection(record)).toThrowError(
      expect.objectContaining({ code: "CORRUPT_PROJECTION" }),
    );
  });

  it("prepares an idempotent empty chain page for atomic persistence", () => {
    const prepared = prepareGiveawayV6ProjectionAdvance({
      record: emptyRecord(),
      page: {
        network: "mainnet",
        removedChainBlockHashes: [],
        addedChainBlockHashes: [],
        blocks: [],
      },
    });

    expect(prepared).toMatchObject({
      status: "applied",
      data: {
        phase: GiveawayV6Phase.AWAITING_ACTIVATION,
        cursorHash: HASH.anchor,
      },
    });
  });

  it("uses a revision guard and stops polling terminal projections", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = { giveawayV6Projection: { updateMany } } as unknown as PrismaClient;

    await persistGiveawayV6ProjectionAdvance(
      prisma,
      { id: "projection-1", syncRevision: 7 },
      {
        status: "applied",
        checkpoint: checkpoint(),
        data: {
          checkpoint: {} as never,
          snapshot: {} as never,
          phase: GiveawayV6Phase.RETURNED,
          observedRegistrationCount: 0,
          frozenEntryCount: 0,
          winnerScriptPublicKeyHex: null,
          terminalTransactionId: "09".repeat(32),
          cursorHash: "07".repeat(32),
          lastPageFingerprint: "08".repeat(32),
        },
      },
      new Date("2026-10-10T12:00:00.000Z"),
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "projection-1", syncRevision: 7 },
        data: expect.objectContaining({ nextSyncAt: null, syncRevision: { increment: 1 } }),
      }),
    );
  });

  it("does not overwrite a newer revision", async () => {
    const prisma = {
      giveawayV6Projection: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaClient;

    await expect(
      persistGiveawayV6ProjectionAdvance(
        prisma,
        { id: "projection-1", syncRevision: 7 },
        { status: "needs_headers", requiredHeaderHashes: ["0a".repeat(32)] },
      ),
    ).rejects.toMatchObject({ code: "STALE_PROJECTION" });
  });
});

function checkpoint(): GiveawayV6ProjectionCheckpoint {
  return {
    schemaVersion: 1,
    network: "mainnet",
    anchorHash: HASH.anchor,
    cursorHash: "07".repeat(32),
    covenantIdHex: HASH.covenant,
    lastPageFingerprint: "08".repeat(32),
    transitions: [],
  };
}
