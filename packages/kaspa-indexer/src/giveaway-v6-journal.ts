import { createHash } from "node:crypto";

import { z } from "zod";

import { parseGiveawayV6ChainEventsJson } from "./giveaway-v6-chain-json";
import type {
  GiveawayV6ChainEvent,
  GiveawayV6ReconstructionConfig,
} from "./giveaway-v6-reconstructor";
import { reconstructGiveawayV6 } from "./giveaway-v6-reconstructor";
import type {
  GiveawayV6ChainProjection,
  GiveawayV6FamilyDescriptor,
} from "./giveaway-v6-projector";
import { projectGiveawayV6Chain } from "./giveaway-v6-projector";
import { decodeGiveawayV6Witness } from "./giveaway-v6-witness";
import type {
  KaspaVspcAcceptedTransaction,
  KaspaVspcHeader,
  KaspaVspcV2Page,
} from "./kaspa-vspc-v2";

const CHECKPOINT_SCHEMA_VERSION = 1 as const;

export type GiveawayV6JournalTransition = {
  acceptingBlockHash: string;
  event: GiveawayV6ChainEvent;
};

export type GiveawayV6ProjectionCheckpoint = {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  network: "mainnet" | "testnet-10";
  anchorHash: string;
  cursorHash: string;
  covenantIdHex: string;
  lastPageFingerprint: string;
  transitions: readonly GiveawayV6JournalTransition[];
};

export type GiveawayV6ProjectionCheckpointJson = {
  schemaVersion: typeof CHECKPOINT_SCHEMA_VERSION;
  network: "mainnet" | "testnet-10";
  anchorHash: string;
  cursorHash: string;
  covenantIdHex: string;
  lastPageFingerprint: string;
  transitions: readonly { acceptingBlockHash: string; event: unknown }[];
};

export type AdvanceGiveawayV6ProjectionInput = {
  checkpoint: GiveawayV6ProjectionCheckpoint | null;
  /** The exact startHash used for this VSPC request. */
  startHash: string;
  page: KaspaVspcV2Page;
  config: GiveawayV6ReconstructionConfig;
  family: GiveawayV6FamilyDescriptor;
  /** Confirmed selected-chain headers resolved for draw references outside this page. */
  confirmedHeaders?: readonly KaspaVspcHeader[];
};

export type AdvanceGiveawayV6ProjectionResult =
  | {
      status: "needs_headers";
      requiredHeaderHashes: readonly string[];
    }
  | {
      status: "applied";
      checkpoint: GiveawayV6ProjectionCheckpoint;
      projection: GiveawayV6ChainProjection;
    };

export type GiveawayV6JournalErrorCode = "INVALID_CHECKPOINT" | "INVALID_PAGE" | "RESET_REQUIRED";

export class GiveawayV6JournalError extends Error {
  readonly code: GiveawayV6JournalErrorCode;

  constructor(code: GiveawayV6JournalErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GiveawayV6JournalError";
    this.code = code;
  }
}

/**
 * Applies one confirmed VSPC page to a compact, restart-safe event journal.
 * Removed selected-chain blocks delete their derived events before additions
 * are replayed. The checkpoint stores public facts only, never witnesses,
 * proofs, wallet material, or private recovery data.
 */
export function advanceGiveawayV6Projection(
  input: AdvanceGiveawayV6ProjectionInput,
): AdvanceGiveawayV6ProjectionResult {
  const startHash = normalizeHash(input.startHash, "start hash", "INVALID_PAGE");
  const covenantIdHex = normalizeHash(
    input.family.covenantIdHex,
    "family covenant ID",
    "INVALID_CHECKPOINT",
  );
  const fingerprint = pageFingerprint(startHash, input.page);
  const checkpoint = input.checkpoint;

  if (checkpoint !== null) {
    validateCheckpointIdentity(checkpoint, input.page.network, covenantIdHex);
    if (checkpoint.lastPageFingerprint === fingerprint) {
      return {
        status: "applied",
        checkpoint,
        projection: projectionFromCheckpoint(input.config, checkpoint),
      };
    }
    if (checkpoint.cursorHash !== startHash) {
      journalFail(
        "INVALID_CHECKPOINT",
        "VSPC start hash does not match the persisted projection cursor.",
      );
    }
  }

  const anchorHash = checkpoint?.anchorHash ?? startHash;
  const removed = new Set(input.page.removedChainBlockHashes);
  if (removed.has(anchorHash)) {
    journalFail(
      "RESET_REQUIRED",
      "The projection anchor left the selected chain; rebuild from an earlier confirmed anchor.",
    );
  }

  const retainedTransitions = (checkpoint?.transitions ?? []).filter(
    (transition) => !removed.has(transition.acceptingBlockHash),
  );
  const initialEvents = retainedTransitions.map((transition) => transition.event);
  try {
    reconstructGiveawayV6(input.config, initialEvents);
  } catch (error) {
    throw new GiveawayV6JournalError(
      "RESET_REQUIRED",
      "Removing reorged blocks left a non-contiguous Giveaway lineage.",
      { cause: error },
    );
  }

  const orderedBlocks = orderAddedBlocks(input.page);
  const existingTransactionIds = new Set(
    retainedTransitions.map((transition) => transition.event.transactionId),
  );
  const familyTransactions = orderedBlocks.flatMap((block) =>
    block.acceptedTransactions.filter((transaction) => {
      if (!transaction.inputs.some((value) => value.utxo.covenantIdHex === covenantIdHex)) {
        return false;
      }
      if (existingTransactionIds.has(transaction.transactionId)) return false;
      existingTransactionIds.add(transaction.transactionId);
      return true;
    }),
  );

  const availableHeaders = new Map<string, KaspaVspcHeader>();
  for (const header of [
    ...orderedBlocks.map((block) => block.header),
    ...(input.confirmedHeaders ?? []),
  ]) {
    const hash = normalizeHash(header.hash, "confirmed header hash", "INVALID_PAGE");
    if (!removed.has(hash)) availableHeaders.set(hash, header);
  }
  const requiredHeaderHashes = collectDrawHeaderHashes(familyTransactions, covenantIdHex);
  const missingHeaders = requiredHeaderHashes.filter((hash) => !availableHeaders.has(hash));
  if (missingHeaders.length > 0) {
    return { status: "needs_headers", requiredHeaderHashes: missingHeaders };
  }

  const projection = projectGiveawayV6Chain({
    config: input.config,
    family: input.family,
    initialEvents,
    transactions: familyTransactions,
    headers: requiredHeaderHashes.map((hash) => availableHeaders.get(hash)!),
  });
  const addedEvents = projection.events.slice(initialEvents.length);
  if (addedEvents.length !== familyTransactions.length) {
    journalFail("INVALID_PAGE", "Each family transaction must produce exactly one transition.");
  }
  const blockByTransactionId = new Map(
    familyTransactions.map((transaction) => [
      transaction.transactionId,
      transaction.acceptingBlockHash,
    ]),
  );
  const addedTransitions = addedEvents.map((event) => {
    const acceptingBlockHash = blockByTransactionId.get(event.transactionId);
    if (acceptingBlockHash === undefined) {
      journalFail("INVALID_PAGE", "Projected transition is missing its accepting block.");
    }
    return { acceptingBlockHash, event };
  });

  const addedTip = input.page.addedChainBlockHashes.at(-1);
  if (addedTip === undefined && checkpoint !== null && removed.has(checkpoint.cursorHash)) {
    journalFail(
      "RESET_REQUIRED",
      "The projection cursor left the selected chain without a replacement tip.",
    );
  }
  const nextCheckpoint: GiveawayV6ProjectionCheckpoint = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    network: input.page.network,
    anchorHash,
    cursorHash: addedTip ?? checkpoint?.cursorHash ?? startHash,
    covenantIdHex,
    lastPageFingerprint: fingerprint,
    transitions: [...retainedTransitions, ...addedTransitions],
  };
  return { status: "applied", checkpoint: nextCheckpoint, projection };
}

/** JSON-safe checkpoint for a database JSON column or durable worker file. */
export function serializeGiveawayV6ProjectionCheckpoint(
  checkpoint: GiveawayV6ProjectionCheckpoint,
): GiveawayV6ProjectionCheckpointJson {
  return {
    ...checkpoint,
    transitions: checkpoint.transitions.map((transition) => ({
      acceptingBlockHash: transition.acceptingBlockHash,
      event: JSON.parse(
        JSON.stringify(transition.event, (_key, value: unknown) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ) as unknown,
    })),
  };
}

const checkpointJsonSchema = z
  .object({
    schemaVersion: z.literal(CHECKPOINT_SCHEMA_VERSION),
    network: z.enum(["mainnet", "testnet-10"]),
    anchorHash: z.string(),
    cursorHash: z.string(),
    covenantIdHex: z.string(),
    lastPageFingerprint: z.string(),
    transitions: z
      .array(z.object({ acceptingBlockHash: z.string(), event: z.unknown() }).strict())
      .max(262_144),
  })
  .strict();

/** Strictly restores a public checkpoint; BigInts must be decimal strings. */
export function parseGiveawayV6ProjectionCheckpoint(
  value: unknown,
): GiveawayV6ProjectionCheckpoint {
  const parsed = checkpointJsonSchema.safeParse(value);
  if (!parsed.success) journalFail("INVALID_CHECKPOINT", "Projection checkpoint is malformed.");
  const transitions = parsed.data.transitions.map((transition) => ({
    acceptingBlockHash: normalizeHash(
      transition.acceptingBlockHash,
      "accepting block hash",
      "INVALID_CHECKPOINT",
    ),
    event: parseGiveawayV6ChainEventsJson([transition.event])[0]!,
  }));
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    network: parsed.data.network,
    anchorHash: normalizeHash(parsed.data.anchorHash, "anchor hash", "INVALID_CHECKPOINT"),
    cursorHash: normalizeHash(parsed.data.cursorHash, "cursor hash", "INVALID_CHECKPOINT"),
    covenantIdHex: normalizeHash(parsed.data.covenantIdHex, "covenant ID", "INVALID_CHECKPOINT"),
    lastPageFingerprint: normalizeHash(
      parsed.data.lastPageFingerprint,
      "page fingerprint",
      "INVALID_CHECKPOINT",
    ),
    transitions,
  };
}

function projectionFromCheckpoint(
  config: GiveawayV6ReconstructionConfig,
  checkpoint: GiveawayV6ProjectionCheckpoint,
): GiveawayV6ChainProjection {
  const events = checkpoint.transitions.map((transition) => transition.event);
  return {
    events,
    snapshot: reconstructGiveawayV6(config, events),
    ignoredTransactionCount: 0,
  };
}

function orderAddedBlocks(page: KaspaVspcV2Page): KaspaVspcV2Page["blocks"] {
  const byHash = new Map(page.blocks.map((block) => [block.header.hash, block]));
  if (byHash.size !== page.blocks.length) {
    journalFail("INVALID_PAGE", "VSPC page contains duplicate Full block records.");
  }
  const ordered = page.addedChainBlockHashes.map((hash) => {
    const block = byHash.get(hash);
    if (block === undefined) {
      journalFail("INVALID_PAGE", "VSPC page is missing a declared added-chain block.");
    }
    return block;
  });
  if (ordered.length !== page.blocks.length) {
    journalFail("INVALID_PAGE", "VSPC page contains a Full block outside the added chain.");
  }
  return ordered;
}

function collectDrawHeaderHashes(
  transactions: readonly KaspaVspcAcceptedTransaction[],
  covenantIdHex: string,
): string[] {
  const hashes = new Set<string>();
  try {
    for (const transaction of transactions) {
      for (const input of transaction.inputs) {
        if (input.utxo.covenantIdHex !== covenantIdHex) continue;
        const witness = decodeGiveawayV6Witness(input.signatureScriptHex);
        if (witness.contract === "prize" && witness.method === "draw") {
          hashes.add(witness.parentBlockHashHex);
          hashes.add(witness.candidateBlockHashHex);
        }
      }
    }
  } catch (error) {
    throw new GiveawayV6JournalError(
      "INVALID_PAGE",
      "Family transaction contains an invalid V6 witness.",
      { cause: error },
    );
  }
  return [...hashes];
}

function validateCheckpointIdentity(
  checkpoint: GiveawayV6ProjectionCheckpoint,
  network: KaspaVspcV2Page["network"],
  covenantIdHex: string,
): void {
  if (
    checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
    checkpoint.network !== network ||
    checkpoint.covenantIdHex !== covenantIdHex
  ) {
    journalFail(
      "INVALID_CHECKPOINT",
      "Projection checkpoint does not belong to this network and covenant family.",
    );
  }
}

function pageFingerprint(startHash: string, page: KaspaVspcV2Page): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        startHash,
        network: page.network,
        removed: page.removedChainBlockHashes,
        added: page.addedChainBlockHashes,
      }),
    )
    .digest("hex");
}

function normalizeHash(value: string, label: string, code: GiveawayV6JournalErrorCode): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/u.test(normalized)) {
    journalFail(code, `${label} must be 32-byte hex.`);
  }
  return normalized;
}

function journalFail(code: GiveawayV6JournalErrorCode, message: string): never {
  throw new GiveawayV6JournalError(code, message);
}
