import { GiveawayV6Phase, Network, type PrismaClient } from "@kaspa-actions/db";
import type { KaspaVspcRelayClient } from "@kaspa-actions/kaspa-indexer";
import { describe, expect, it, vi } from "vitest";

import { buildGiveawayV6ProjectionCreateData } from "./giveaway-v6-projection.ts";
import { syncDueGiveawayV6Projections } from "./giveaway-v6-sync.ts";

const HASH = {
  anchor: "01".repeat(32),
  covenant: "02".repeat(32),
  giveaway: "03".repeat(32),
  genesis: "04".repeat(32),
  prize: "05".repeat(32),
  shard: "06".repeat(32),
};

function record() {
  const data = buildGiveawayV6ProjectionCreateData({
    network: Network.MAINNET,
    anchorHash: HASH.anchor,
    config: {
      giveawayIdHex: HASH.giveaway,
      closesAtDaa: 100n,
      returnAtDaa: 200n,
      entropyTargetBlueScore: 150n,
      shardCount: 1,
      treeDepth: 4,
      maxEntriesPerShard: 16,
      returnScriptPublicKeyHex: "000051",
    },
    family: {
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
    },
  });
  return {
    id: "projection-1",
    createdAt: new Date("2026-10-10T10:00:00.000Z"),
    nextSyncAt: new Date("2026-10-10T11:59:00.000Z"),
    ...data,
    checkpoint: null,
    syncRevision: 0,
  };
}

function relay(overrides: Partial<KaspaVspcRelayClient> = {}): KaspaVspcRelayClient {
  return {
    getCurrentNetwork: vi.fn().mockResolvedValue({ network: "mainnet" }),
    getVirtualChainFromBlockV2: vi.fn().mockResolvedValue({
      removedChainBlockHashes: [],
      addedChainBlockHashes: [],
      chainBlockAcceptedTransactions: [],
    }),
    getBlockHeaders: vi.fn(),
    ...overrides,
  };
}

describe("Giveaway V6 projection worker", () => {
  it("leases and atomically advances a due projection", async () => {
    const row = record();
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      giveawayV6Projection: {
        findMany: vi.fn().mockResolvedValue([row]),
        updateMany,
      },
    } as unknown as PrismaClient;
    const now = new Date("2026-10-10T12:00:00.000Z");

    await expect(syncDueGiveawayV6Projections(prisma, relay(), now)).resolves.toEqual({
      processed: 1,
      failed: 0,
      skipped: 0,
    });
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ id: row.id, syncRevision: 0 }) }),
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          phase: GiveawayV6Phase.AWAITING_ACTIVATION,
          syncRevision: { increment: 1 },
        }),
      }),
    );
  });

  it("skips a row leased by another worker without reading RPC", async () => {
    const rpc = relay();
    const prisma = {
      giveawayV6Projection: {
        findMany: vi.fn().mockResolvedValue([record()]),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaClient;

    await expect(syncDueGiveawayV6Projections(prisma, rpc)).resolves.toEqual({
      processed: 0,
      failed: 0,
      skipped: 1,
    });
    expect(rpc.getCurrentNetwork).not.toHaveBeenCalled();
  });

  it("stores only a stable error code and retries transient RPC failures", async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma = {
      giveawayV6Projection: {
        findMany: vi.fn().mockResolvedValue([record()]),
        updateMany,
      },
    } as unknown as PrismaClient;
    const rpc = relay({
      getCurrentNetwork: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("private relay detail"), { code: "ECONNRESET" }),
        ),
    });
    const now = new Date("2026-10-10T12:00:00.000Z");

    await expect(syncDueGiveawayV6Projections(prisma, rpc, now)).resolves.toEqual({
      processed: 0,
      failed: 1,
      skipped: 0,
    });
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          lastErrorCode: "VSPC_RPC_ERROR",
          nextSyncAt: new Date("2026-10-10T12:00:15.000Z"),
        }),
      }),
    );
    expect(JSON.stringify(updateMany.mock.calls[1])).not.toContain("private relay detail");
  });
});
