import { GiveawayV6Phase, Network, Prisma, type PrismaClient } from "@kaspa-actions/db";
import {
  advanceGiveawayV6Projection,
  parseGiveawayV6ConfigJson,
  parseGiveawayV6FamilyJson,
  parseGiveawayV6ProjectionCheckpoint,
  reconstructGiveawayV6,
  serializeGiveawayV6ConfigJson,
  serializeGiveawayV6FamilyJson,
  serializeGiveawayV6ProjectionCheckpoint,
  serializeGiveawayV6Snapshot,
  type GiveawayV6FamilyDescriptor,
  type GiveawayV6ProjectionCheckpoint,
  type GiveawayV6ReconstructionSnapshot,
  type GiveawayV6ReconstructionConfig,
  type KaspaVspcHeader,
  type KaspaVspcV2Page,
} from "@kaspa-actions/kaspa-indexer";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;

export type GiveawayV6ProjectionRecord = {
  id: string;
  network: Network;
  covenantIdHex: string;
  anchorHash: string;
  config: unknown;
  family: unknown;
  checkpoint: unknown | null;
  phase: GiveawayV6Phase;
  observedRegistrationCount: number;
  frozenEntryCount: number | null;
  winnerScriptPublicKeyHex: string | null;
  terminalTransactionId: string | null;
  cursorHash: string | null;
  lastPageFingerprint: string | null;
  syncRevision: number;
};

export type RestoredGiveawayV6Projection = {
  config: GiveawayV6ReconstructionConfig;
  family: GiveawayV6FamilyDescriptor;
  checkpoint: GiveawayV6ProjectionCheckpoint | null;
  snapshot: GiveawayV6ReconstructionSnapshot;
};

export type PreparedGiveawayV6ProjectionAdvance =
  | {
      status: "needs_headers";
      requiredHeaderHashes: readonly string[];
    }
  | {
      status: "applied";
      checkpoint: GiveawayV6ProjectionCheckpoint;
      data: {
        checkpoint: Prisma.InputJsonValue;
        snapshot: Prisma.InputJsonValue;
        phase: GiveawayV6Phase;
        observedRegistrationCount: number;
        frozenEntryCount: number | null;
        winnerScriptPublicKeyHex: string | null;
        terminalTransactionId: string | null;
        cursorHash: string;
        lastPageFingerprint: string;
      };
    };

export class GiveawayV6ProjectionPersistenceError extends Error {
  readonly code: "CORRUPT_PROJECTION" | "STALE_PROJECTION";

  constructor(code: "CORRUPT_PROJECTION" | "STALE_PROJECTION", message: string) {
    super(message);
    this.name = "GiveawayV6ProjectionPersistenceError";
    this.code = code;
  }
}

/**
 * Produces the public-only values required when a V6 family is registered for
 * indexing. The empty snapshot is derived from the protocol config rather than
 * supplied by a browser.
 */
export function buildGiveawayV6ProjectionCreateData(input: {
  network: Network;
  anchorHash: string;
  config: GiveawayV6ReconstructionConfig;
  family: GiveawayV6FamilyDescriptor;
}) {
  const anchorHash = normalizeHash(input.anchorHash, "projection anchor");
  const config = parseGiveawayV6ConfigJson(serializeGiveawayV6ConfigJson(input.config));
  const family = parseGiveawayV6FamilyJson(serializeGiveawayV6FamilyJson(input.family));
  const snapshot = reconstructGiveawayV6(config, []);

  return {
    network: input.network,
    covenantIdHex: family.covenantIdHex,
    anchorHash,
    config: serializeGiveawayV6ConfigJson(config) as Prisma.InputJsonValue,
    family: serializeGiveawayV6FamilyJson(family) as Prisma.InputJsonValue,
    snapshot: serializeGiveawayV6Snapshot(snapshot) as Prisma.InputJsonValue,
    phase: GiveawayV6Phase.AWAITING_ACTIVATION,
    observedRegistrationCount: 0,
    frozenEntryCount: null,
    winnerScriptPublicKeyHex: null,
    terminalTransactionId: null,
    cursorHash: null,
    lastPageFingerprint: null,
  };
}

/** Restores and cross-checks a persisted projection before another chain page is applied. */
export function restoreGiveawayV6Projection(
  record: GiveawayV6ProjectionRecord,
): RestoredGiveawayV6Projection {
  const config = parseGiveawayV6ConfigJson(record.config);
  const family = parseGiveawayV6FamilyJson(record.family);
  const anchorHash = normalizeHash(record.anchorHash, "projection anchor");
  const covenantIdHex = normalizeHash(record.covenantIdHex, "projection covenant ID");
  if (family.covenantIdHex !== covenantIdHex) corrupt("Stored covenant IDs disagree.");

  const checkpoint =
    record.checkpoint === null ? null : parseGiveawayV6ProjectionCheckpoint(record.checkpoint);
  if (checkpoint !== null) {
    if (
      checkpoint.anchorHash !== anchorHash ||
      checkpoint.covenantIdHex !== covenantIdHex ||
      checkpoint.network !== networkId(record.network) ||
      checkpoint.cursorHash !== record.cursorHash ||
      checkpoint.lastPageFingerprint !== record.lastPageFingerprint
    ) {
      corrupt("Stored checkpoint identity disagrees with its indexed columns.");
    }
  } else if (record.cursorHash !== null || record.lastPageFingerprint !== null) {
    corrupt("An empty checkpoint cannot have a cursor or page fingerprint.");
  }

  const snapshot = reconstructGiveawayV6(
    config,
    checkpoint?.transitions.map((transition) => transition.event) ?? [],
  );
  if (
    phaseToDatabase(snapshot.phase) !== record.phase ||
    snapshot.observedRegistrationCount !== record.observedRegistrationCount ||
    snapshot.frozenEntryCount !== record.frozenEntryCount ||
    (snapshot.winner?.payoutScriptPublicKeyHex ?? null) !== record.winnerScriptPublicKeyHex ||
    snapshot.terminalTransactionId !== record.terminalTransactionId
  ) {
    corrupt("Stored projection indexes disagree with the reconstructed checkpoint.");
  }

  return { config, family, checkpoint, snapshot };
}

/** Applies one normalized confirmed page and prepares one atomic database update. */
export function prepareGiveawayV6ProjectionAdvance(input: {
  record: GiveawayV6ProjectionRecord;
  page: KaspaVspcV2Page;
  confirmedHeaders?: readonly KaspaVspcHeader[];
}): PreparedGiveawayV6ProjectionAdvance {
  const restored = restoreGiveawayV6Projection(input.record);
  const result = advanceGiveawayV6Projection({
    checkpoint: restored.checkpoint,
    startHash: restored.checkpoint?.cursorHash ?? input.record.anchorHash,
    page: input.page,
    config: restored.config,
    family: restored.family,
    confirmedHeaders: input.confirmedHeaders,
  });
  if (result.status === "needs_headers") return result;

  const snapshot = result.projection.snapshot;
  return {
    status: "applied",
    checkpoint: result.checkpoint,
    data: {
      checkpoint: serializeGiveawayV6ProjectionCheckpoint(
        result.checkpoint,
      ) as Prisma.InputJsonValue,
      snapshot: serializeGiveawayV6Snapshot(snapshot) as Prisma.InputJsonValue,
      phase: phaseToDatabase(snapshot.phase),
      observedRegistrationCount: snapshot.observedRegistrationCount,
      frozenEntryCount: snapshot.frozenEntryCount,
      winnerScriptPublicKeyHex: snapshot.winner?.payoutScriptPublicKeyHex ?? null,
      terminalTransactionId: snapshot.terminalTransactionId,
      cursorHash: result.checkpoint.cursorHash,
      lastPageFingerprint: result.checkpoint.lastPageFingerprint,
    },
  };
}

/**
 * Persists a prepared page only if the worker still owns the revision it read.
 * A competing worker wins cleanly; the loser never overwrites newer chain data.
 */
export async function persistGiveawayV6ProjectionAdvance(
  prisma: PrismaClient,
  record: Pick<GiveawayV6ProjectionRecord, "id" | "syncRevision">,
  prepared: PreparedGiveawayV6ProjectionAdvance,
  now = new Date(),
): Promise<void> {
  const data =
    prepared.status === "needs_headers"
      ? {
          requiredHeaderHashes: [...prepared.requiredHeaderHashes] as Prisma.InputJsonValue,
          lastErrorCode: "MISSING_HEADERS",
          lastErrorAt: now,
          nextSyncAt: new Date(now.getTime() + 15_000),
          syncRevision: { increment: 1 },
        }
      : {
          ...prepared.data,
          requiredHeaderHashes: Prisma.DbNull,
          lastErrorCode: null,
          lastErrorAt: null,
          lastSyncedAt: now,
          nextSyncAt:
            prepared.data.phase === GiveawayV6Phase.DRAWN ||
            prepared.data.phase === GiveawayV6Phase.RETURNED
              ? null
              : new Date(now.getTime() + 5_000),
          syncRevision: { increment: 1 },
        };
  const updated = await prisma.giveawayV6Projection.updateMany({
    data,
    where: { id: record.id, syncRevision: record.syncRevision },
  });
  if (updated.count !== 1) {
    throw new GiveawayV6ProjectionPersistenceError(
      "STALE_PROJECTION",
      "A newer Giveaway V6 projection revision already exists.",
    );
  }
}

function networkId(network: Network): "mainnet" | "testnet-10" {
  return network === Network.MAINNET ? "mainnet" : "testnet-10";
}

function phaseToDatabase(
  phase: "awaiting_activation" | "open" | "frozen" | "drawn" | "returned",
): GiveawayV6Phase {
  if (phase === "awaiting_activation") return GiveawayV6Phase.AWAITING_ACTIVATION;
  if (phase === "open") return GiveawayV6Phase.OPEN;
  if (phase === "frozen") return GiveawayV6Phase.FROZEN;
  if (phase === "drawn") return GiveawayV6Phase.DRAWN;
  return GiveawayV6Phase.RETURNED;
}

function normalizeHash(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!HASH_PATTERN.test(normalized)) corrupt(`${label} must be 32-byte hex.`);
  return normalized;
}

function corrupt(message: string): never {
  throw new GiveawayV6ProjectionPersistenceError("CORRUPT_PROJECTION", message);
}
