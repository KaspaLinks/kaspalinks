import { GiveawayV6Phase, type PrismaClient } from "@kaspa-actions/db";
import {
  readKaspaVspcHeaders,
  readKaspaVspcV2Page,
  type KaspaVspcRelayClient,
} from "@kaspa-actions/kaspa-indexer";

import {
  GiveawayV6ProjectionPersistenceError,
  persistGiveawayV6ProjectionAdvance,
  prepareGiveawayV6ProjectionAdvance,
  type GiveawayV6ProjectionRecord,
} from "./giveaway-v6-projection.ts";

const DEFAULT_BATCH_SIZE = 3;
const LEASE_MS = 120_000;
const RETRY_MS = 15_000;

const projectionSelect = {
  id: true,
  network: true,
  covenantIdHex: true,
  anchorHash: true,
  config: true,
  family: true,
  checkpoint: true,
  phase: true,
  observedRegistrationCount: true,
  frozenEntryCount: true,
  winnerScriptPublicKeyHex: true,
  terminalTransactionId: true,
  cursorHash: true,
  lastPageFingerprint: true,
  syncRevision: true,
} as const;

export type GiveawayV6SyncSummary = {
  processed: number;
  failed: number;
  skipped: number;
};

/**
 * Advances a small batch of confirmed V6 chain projections. A short database
 * lease prevents duplicate RPC work, and the revision guard prevents an old
 * response from overwriting a newer reorg-aware checkpoint.
 */
export async function syncDueGiveawayV6Projections(
  prisma: PrismaClient,
  client: KaspaVspcRelayClient,
  now = new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<GiveawayV6SyncSummary> {
  const take = Math.min(Math.max(batchSize, 1), 10);
  const due = await prisma.giveawayV6Projection.findMany({
    orderBy: [{ nextSyncAt: "asc" }, { createdAt: "asc" }],
    select: projectionSelect,
    take,
    where: {
      nextSyncAt: { lte: now },
      phase: { notIn: [GiveawayV6Phase.DRAWN, GiveawayV6Phase.RETURNED] },
    },
  });

  const summary: GiveawayV6SyncSummary = { processed: 0, failed: 0, skipped: 0 };
  for (const candidate of due) {
    const claimed = await prisma.giveawayV6Projection.updateMany({
      data: { nextSyncAt: new Date(now.getTime() + LEASE_MS) },
      where: {
        id: candidate.id,
        syncRevision: candidate.syncRevision,
        nextSyncAt: { lte: now },
      },
    });
    if (claimed.count !== 1) {
      summary.skipped += 1;
      continue;
    }

    try {
      await syncOne(prisma, client, candidate, now);
      summary.processed += 1;
    } catch (error) {
      if (
        error instanceof GiveawayV6ProjectionPersistenceError &&
        error.code === "STALE_PROJECTION"
      ) {
        summary.skipped += 1;
        continue;
      }
      await recordFailure(prisma, candidate, error, now);
      summary.failed += 1;
    }
  }
  return summary;
}

async function syncOne(
  prisma: PrismaClient,
  client: KaspaVspcRelayClient,
  record: GiveawayV6ProjectionRecord,
  now: Date,
): Promise<void> {
  const page = await readKaspaVspcV2Page(client, {
    startHash: record.cursorHash ?? record.anchorHash,
    expectedNetwork: record.network === "MAINNET" ? "mainnet" : "testnet-10",
  });
  let prepared = prepareGiveawayV6ProjectionAdvance({ record, page });
  if (prepared.status === "needs_headers") {
    const confirmedHeaders = await readKaspaVspcHeaders(client, prepared.requiredHeaderHashes);
    prepared = prepareGiveawayV6ProjectionAdvance({ record, page, confirmedHeaders });
  }
  await persistGiveawayV6ProjectionAdvance(prisma, record, prepared, now);
}

async function recordFailure(
  prisma: PrismaClient,
  record: Pick<GiveawayV6ProjectionRecord, "id" | "syncRevision">,
  error: unknown,
  now: Date,
): Promise<void> {
  const code = publicErrorCode(error);
  const retry = code === "VSPC_RPC_ERROR";
  await prisma.giveawayV6Projection.updateMany({
    data: {
      lastErrorCode: code,
      lastErrorAt: now,
      nextSyncAt: retry ? new Date(now.getTime() + RETRY_MS) : null,
      syncRevision: { increment: 1 },
    },
    where: { id: record.id, syncRevision: record.syncRevision },
  });
}

function publicErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "PROJECTION_FAILED";
}
