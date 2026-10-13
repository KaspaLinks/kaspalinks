import fs from "node:fs";
import path from "node:path";

import {
  GiveawayV6Phase,
  GiveawayV6TransitionKind,
  Network,
  type PrismaClient,
} from "@kaspa-actions/db";
import {
  serializeGiveawayV6ConfigJson,
  serializeGiveawayV6FamilyJson,
  type GiveawayV6FamilyDescriptor,
  type GiveawayV6ReconstructionConfig,
  type KaspaVspcRelayClient,
} from "@kaspa-actions/kaspa-indexer";
import { describe, expect, it, vi } from "vitest";

import { executeDueGiveawayV6Settlements } from "./giveaway-v6-executor";

const abi = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "labs/claimable-script/fixtures/giveaway_v6_abi_vectors.json"),
    "utf8",
  ),
) as {
  prize: { redeemScriptHex: string; templateHashHex: string };
  shard: { redeemScriptHex: string; templateHashHex: string };
};

const HASH = {
  activationBlock: "01".repeat(32),
  anchor: "02".repeat(32),
  covenant: "03".repeat(32),
  cursor: "04".repeat(32),
  fingerprint: "05".repeat(32),
  funding: "06".repeat(32),
  parent: "07".repeat(32),
};

const config: GiveawayV6ReconstructionConfig = {
  giveawayIdHex: "42".repeat(32),
  closesAtDaa: 500_000_000n,
  returnAtDaa: 500_100_000n,
  entropyTargetBlueScore: 500_000_100n,
  shardCount: 4,
  treeDepth: 10,
  maxEntriesPerShard: 8,
  returnScriptPublicKeyHex: "000051",
};

const family: GiveawayV6FamilyDescriptor = {
  genesisOutpoint: { transactionId: HASH.funding, outputIndex: 0 },
  covenantIdHex: HASH.covenant,
  prizeTemplateHashHex: abi.prize.templateHashHex,
  shardTemplateHashHex: abi.shard.templateHashHex,
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 101_000_000n,
  entryFeeSompi: 10_000_000n,
  activationFeeSompi: 10_000_000n,
  freezeFeeSompi: 33_000_000n,
  drawFeeSompi: 18_000_000n,
  returnFeeSompi: 3_000_000n,
};

describe("Giveaway V6 settlement executor", () => {
  it("leases, persists, and relays one deterministic freeze", async () => {
    const activation = {
      kind: "activate" as const,
      transactionId: "11".repeat(32),
      blockDaaScore: 499_000_000n,
      prizeOutputIndex: 0,
      shardOutputIndexes: [1, 2, 3, 4],
    };
    const record = {
      id: "projection-id",
      giveawayId: "giveaway-id",
      network: Network.MAINNET,
      covenantIdHex: family.covenantIdHex,
      anchorHash: HASH.anchor,
      config: serializeGiveawayV6ConfigJson(config),
      family: serializeGiveawayV6FamilyJson(family),
      checkpoint: {
        schemaVersion: 1,
        network: "mainnet",
        anchorHash: HASH.anchor,
        cursorHash: HASH.cursor,
        covenantIdHex: family.covenantIdHex,
        lastPageFingerprint: HASH.fingerprint,
        transitions: [
          {
            acceptingBlockHash: HASH.activationBlock,
            event: { ...activation, blockDaaScore: activation.blockDaaScore.toString() },
          },
        ],
      },
      phase: GiveawayV6Phase.OPEN,
      observedRegistrationCount: 0,
      frozenEntryCount: null,
      winnerScriptPublicKeyHex: null,
      terminalTransactionId: null,
      cursorHash: HASH.cursor,
      lastPageFingerprint: HASH.fingerprint,
      syncRevision: 1,
      executionLeaseRevision: 3,
      giveaway: {
        v6Bootstrap: {
          fundingBlockDaaScore: 498_000_000n,
          prizeRedeemScriptHex: abi.prize.redeemScriptHex,
          shardTemplateRedeemScriptHex: abi.shard.redeemScriptHex,
        },
      },
    };
    const projectionUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const deliveryUpdate = vi.fn().mockResolvedValue({});
    const deliveryUpsert = vi.fn(async ({ create }) => ({
      id: "delivery-id",
      projectionId: create.projectionId,
      kind: create.kind,
      transactionId: create.transactionId,
      transactionSafeJson: create.transactionSafeJson,
      submittedAt: null,
    }));
    const prisma = {
      giveawayV6Projection: {
        findMany: vi.fn().mockResolvedValue([record]),
        updateMany: projectionUpdate,
      },
      giveawayV6TransitionDelivery: {
        upsert: deliveryUpsert,
        update: deliveryUpdate,
      },
    } as unknown as PrismaClient;
    const submitTransaction = vi.fn().mockImplementation(async ({ expectedTransactionId }) => ({
      localTransactionId: expectedTransactionId,
      submittedTransactionId: expectedTransactionId,
    }));
    const relay = {
      getCurrentNetwork: vi.fn(),
      getVirtualChainFromBlockV2: vi.fn(),
      getBlockHeaders: vi.fn().mockResolvedValue({
        blocks: [
          {
            block: {
              header: {
                hash: HASH.cursor,
                parentsByLevel: [[HASH.parent]],
                acceptedIdMerkleRoot: "08".repeat(32),
                daaScore: "500000010",
                blueScore: "500000010",
              },
            },
          },
        ],
      }),
      submitTransaction,
    } as KaspaVspcRelayClient;
    const now = new Date("2026-10-12T20:00:00.000Z");

    await expect(executeDueGiveawayV6Settlements(prisma, relay, null, now)).resolves.toEqual({
      processed: 1,
      submitted: 1,
      waiting: 0,
      failed: 0,
      skipped: 0,
    });
    expect(deliveryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ kind: GiveawayV6TransitionKind.FREEZE }),
      }),
    );
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submittedAt: now }) }),
    );
    expect(JSON.stringify(deliveryUpsert.mock.calls)).not.toMatch(/privateKey|seedPhrase/i);
  });
});
