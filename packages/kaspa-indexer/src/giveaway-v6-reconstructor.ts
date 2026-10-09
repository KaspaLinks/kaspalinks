import { createHash } from "node:crypto";

const HASH_BYTES = 32;
const ADDRESS_TREE_DEPTH = 256;
const MAX_U64 = (1n << 64n) - 1n;
const ZERO_HASH = new Uint8Array(HASH_BYTES);

export type GiveawayV6ReconstructionErrorCode =
  | "DUPLICATE_ENTRY"
  | "FROZEN_STATE_MISMATCH"
  | "INVALID_CONFIG"
  | "INVALID_EVENT"
  | "INVALID_LINEAGE"
  | "INVALID_STATE"
  | "WINNER_MISMATCH"
  | "WRONG_SHARD";

export class GiveawayV6ReconstructionError extends Error {
  readonly code: GiveawayV6ReconstructionErrorCode;

  constructor(code: GiveawayV6ReconstructionErrorCode, message: string) {
    super(message);
    this.name = "GiveawayV6ReconstructionError";
    this.code = code;
  }
}

export type GiveawayV6Outpoint = {
  transactionId: string;
  outputIndex: number;
};

export type GiveawayV6ReconstructionConfig = {
  giveawayIdHex: string;
  closesAtDaa: bigint;
  returnAtDaa: bigint;
  entropyTargetBlueScore: bigint;
  shardCount: number;
  treeDepth: number;
  maxEntriesPerShard: number;
  returnScriptPublicKeyHex: string;
};

export type GiveawayV6ActivationEvent = {
  kind: "activate";
  transactionId: string;
  blockDaaScore: bigint;
  prizeOutputIndex: number;
  shardOutputIndexes: readonly number[];
};

export type GiveawayV6RegistrationEvent = {
  kind: "register";
  transactionId: string;
  blockDaaScore: bigint;
  shardIndex: number;
  consumedOutpoint: GiveawayV6Outpoint;
  producedOutputIndex: number;
  payoutScriptPublicKeyHex: string;
};

export type GiveawayV6FreezeEvent = {
  kind: "freeze";
  transactionId: string;
  blockDaaScore: bigint;
  prizeInputOutpoint: GiveawayV6Outpoint;
  shardInputOutpoints: readonly GiveawayV6Outpoint[];
  frozenOutputIndex: number;
  observedFrozenRootHex: string;
  observedEntryCount: number;
};

export type GiveawayV6DrawEvent = {
  kind: "draw";
  transactionId: string;
  blockDaaScore: bigint;
  frozenInputOutpoint: GiveawayV6Outpoint;
  parentBlockHashHex: string;
  parentBlueScore: bigint;
  parentSequenceCommitmentHex: string;
  candidateBlockHashHex: string;
  candidateBlueScore: bigint;
  candidateSequenceCommitmentHex: string;
  winnerOutputScriptPublicKeyHex: string;
  returnOutputScriptPublicKeyHex: string;
};

export type GiveawayV6ReturnEvent = {
  kind: "return";
  transactionId: string;
  blockDaaScore: bigint;
  frozenInputOutpoint: GiveawayV6Outpoint;
  returnOutputScriptPublicKeyHex: string;
};

export type GiveawayV6ChainEvent =
  | GiveawayV6ActivationEvent
  | GiveawayV6RegistrationEvent
  | GiveawayV6FreezeEvent
  | GiveawayV6DrawEvent
  | GiveawayV6ReturnEvent;

export type GiveawayV6EntrySnapshot = {
  commitmentHex: string;
  payoutScriptPublicKeyHex: string;
  registrationTransactionId: string;
  registeredAtDaa: bigint;
};

export type GiveawayV6ShardSnapshot = {
  shardIndex: number;
  finalizedEntryCount: number;
  entriesRootHex: string;
  addressRootHex: string;
  finalizedEntries: readonly GiveawayV6EntrySnapshot[];
  pendingEntry: GiveawayV6EntrySnapshot | null;
  excludedLateEntry: GiveawayV6EntrySnapshot | null;
  tipOutpoint: GiveawayV6Outpoint | null;
};

export type GiveawayV6WinnerSnapshot = {
  globalIndex: number;
  shardIndex: number;
  localIndex: number;
  payoutScriptPublicKeyHex: string;
  commitmentHex: string;
  merkleSiblingsHex: readonly string[];
  candidateBlockHashHex: string;
  candidateSequenceCommitmentHex: string;
  drawTransactionId: string;
};

export type GiveawayV6ReconstructionSnapshot = {
  phase: "awaiting_activation" | "open" | "frozen" | "drawn" | "returned";
  activationTransactionId: string | null;
  freezeTransactionId: string | null;
  terminalTransactionId: string | null;
  prizeOutpoint: GiveawayV6Outpoint | null;
  observedRegistrationCount: number;
  frozenEntryCount: number | null;
  frozenRootHex: string | null;
  shards: readonly GiveawayV6ShardSnapshot[];
  winner: GiveawayV6WinnerSnapshot | null;
};

export type GiveawayV6PublicSnapshot = Omit<GiveawayV6ReconstructionSnapshot, "shards"> & {
  shards: readonly (Omit<
    GiveawayV6ShardSnapshot,
    "finalizedEntries" | "pendingEntry" | "excludedLateEntry"
  > & {
    finalizedEntries: readonly (Omit<GiveawayV6EntrySnapshot, "registeredAtDaa"> & {
      registeredAtDaa: string;
    })[];
    pendingEntry:
      | (Omit<GiveawayV6EntrySnapshot, "registeredAtDaa"> & { registeredAtDaa: string })
      | null;
    excludedLateEntry:
      | (Omit<GiveawayV6EntrySnapshot, "registeredAtDaa"> & { registeredAtDaa: string })
      | null;
  })[];
};

type NormalizedConfig = GiveawayV6ReconstructionConfig & {
  giveawayIdHex: string;
  returnScriptPublicKeyHex: string;
};

type MutableShard = {
  shardIndex: number;
  finalizedEntries: GiveawayV6EntrySnapshot[];
  allCommitments: Uint8Array[];
  pendingEntry: GiveawayV6EntrySnapshot | null;
  excludedLateEntry: GiveawayV6EntrySnapshot | null;
  tipOutpoint: GiveawayV6Outpoint | null;
};

/**
 * Replays decoded, accepted V6 covenant transitions in lineage order. The
 * caller must derive each event from public transaction data; database rows
 * are deliberately not accepted as an authority for participants or results.
 */
export function reconstructGiveawayV6(
  configInput: GiveawayV6ReconstructionConfig,
  events: readonly GiveawayV6ChainEvent[],
): GiveawayV6ReconstructionSnapshot {
  const config = normalizeConfig(configInput);
  const shards: MutableShard[] = Array.from({ length: config.shardCount }, (_, shardIndex) => ({
    shardIndex,
    finalizedEntries: [],
    allCommitments: [],
    pendingEntry: null,
    excludedLateEntry: null,
    tipOutpoint: null,
  }));
  const transactionIds = new Set<string>();
  const commitments = new Set<string>();
  let phase: GiveawayV6ReconstructionSnapshot["phase"] = "awaiting_activation";
  let activationTransactionId: string | null = null;
  let freezeTransactionId: string | null = null;
  let terminalTransactionId: string | null = null;
  let prizeOutpoint: GiveawayV6Outpoint | null = null;
  let frozenRootHex: string | null = null;
  let frozenEntryCount: number | null = null;
  let winner: GiveawayV6WinnerSnapshot | null = null;

  for (const event of events) {
    const transactionId = normalizeHashHex(event.transactionId, "transaction ID", "INVALID_EVENT");
    if (transactionIds.has(transactionId)) {
      fail("INVALID_EVENT", "A transaction may appear only once in a reconstruction.");
    }
    transactionIds.add(transactionId);
    validateU64(event.blockDaaScore, "block DAA score", "INVALID_EVENT");

    if (event.kind === "activate") {
      if (phase !== "awaiting_activation") {
        fail("INVALID_STATE", "Activation must be the first transition.");
      }
      const prizeOutputIndex = validateOutputIndex(event.prizeOutputIndex, "prize output index");
      if (event.shardOutputIndexes.length !== config.shardCount) {
        fail("INVALID_EVENT", "Activation must create exactly one output per configured shard.");
      }
      const outputIndexes = [
        prizeOutputIndex,
        ...event.shardOutputIndexes.map((value) =>
          validateOutputIndex(value, "shard output index"),
        ),
      ];
      if (new Set(outputIndexes).size !== outputIndexes.length) {
        fail("INVALID_EVENT", "Activation output indexes must be unique.");
      }
      activationTransactionId = transactionId;
      prizeOutpoint = { transactionId, outputIndex: prizeOutputIndex };
      shards.forEach((shard, index) => {
        shard.tipOutpoint = { transactionId, outputIndex: outputIndexes[index + 1]! };
      });
      phase = "open";
      continue;
    }

    if (event.kind === "register") {
      if (phase !== "open") fail("INVALID_STATE", "Registrations require an open giveaway.");
      if (
        !Number.isInteger(event.shardIndex) ||
        event.shardIndex < 0 ||
        event.shardIndex >= config.shardCount
      ) {
        fail("INVALID_EVENT", "Registration shard index is outside the configured shard range.");
      }
      const shard = shards[event.shardIndex]!;
      assertSameOutpoint(event.consumedOutpoint, shard.tipOutpoint, "registration shard input");
      if (
        shard.finalizedEntries.length + (shard.pendingEntry === null ? 0 : 1) >=
        config.maxEntriesPerShard
      ) {
        fail("INVALID_STATE", "Registration exceeds the shard capacity committed by the covenant.");
      }
      if (shard.pendingEntry !== null) {
        if (shard.pendingEntry.registeredAtDaa > config.closesAtDaa) {
          fail(
            "INVALID_STATE",
            "A late pending registration cannot be advanced into the ordered entry tree.",
          );
        }
        shard.finalizedEntries.push(shard.pendingEntry);
      }

      const payoutScriptPublicKeyHex = normalizeScriptHex(
        event.payoutScriptPublicKeyHex,
        "registration payout script",
      );
      const commitment = sha256(hexToBytes(payoutScriptPublicKeyHex));
      const commitmentHex = toHex(commitment);
      const expectedShard = commitment[0]! % config.shardCount;
      if (expectedShard !== event.shardIndex) {
        fail(
          "WRONG_SHARD",
          "Registration does not use the shard selected by its payout commitment.",
        );
      }
      if (commitments.has(commitmentHex)) {
        fail("DUPLICATE_ENTRY", "A payout commitment may be registered only once.");
      }
      commitments.add(commitmentHex);
      const entry: GiveawayV6EntrySnapshot = {
        commitmentHex,
        payoutScriptPublicKeyHex,
        registrationTransactionId: transactionId,
        registeredAtDaa: event.blockDaaScore,
      };
      shard.pendingEntry = entry;
      shard.allCommitments.push(commitment);
      shard.tipOutpoint = {
        transactionId,
        outputIndex: validateOutputIndex(event.producedOutputIndex, "registration output index"),
      };
      continue;
    }

    if (event.kind === "freeze") {
      if (phase !== "open") fail("INVALID_STATE", "Freeze requires an open giveaway.");
      if (event.blockDaaScore < config.closesAtDaa) {
        fail("INVALID_STATE", "Freeze happened before the committed closing DAA score.");
      }
      assertSameOutpoint(event.prizeInputOutpoint, prizeOutpoint, "freeze prize input");
      if (event.shardInputOutpoints.length !== config.shardCount) {
        fail("INVALID_LINEAGE", "Freeze must consume every configured shard tip.");
      }
      shards.forEach((shard, index) => {
        assertSameOutpoint(
          event.shardInputOutpoints[index]!,
          shard.tipOutpoint,
          `freeze shard ${index} input`,
        );
        if (shard.pendingEntry !== null) {
          if (shard.pendingEntry.registeredAtDaa <= config.closesAtDaa) {
            shard.finalizedEntries.push(shard.pendingEntry);
          } else {
            shard.excludedLateEntry = shard.pendingEntry;
          }
          shard.pendingEntry = null;
        }
        shard.tipOutpoint = null;
      });

      const computed = computeFrozenState(shards, config.treeDepth);
      const observedFrozenRootHex = normalizeHashHex(
        event.observedFrozenRootHex,
        "observed frozen root",
        "INVALID_EVENT",
      );
      if (
        observedFrozenRootHex !== computed.frozenRootHex ||
        event.observedEntryCount !== computed.entryCount
      ) {
        fail(
          "FROZEN_STATE_MISMATCH",
          "Observed frozen state does not match the reconstructed chain history.",
        );
      }
      frozenRootHex = computed.frozenRootHex;
      frozenEntryCount = computed.entryCount;
      freezeTransactionId = transactionId;
      prizeOutpoint = {
        transactionId,
        outputIndex: validateOutputIndex(event.frozenOutputIndex, "frozen output index"),
      };
      phase = "frozen";
      continue;
    }

    if (event.kind === "draw") {
      if (phase !== "frozen" || frozenRootHex === null || frozenEntryCount === null) {
        fail("INVALID_STATE", "Draw requires a reconstructed frozen giveaway.");
      }
      if (frozenEntryCount === 0)
        fail("INVALID_STATE", "An empty frozen giveaway cannot be drawn.");
      assertSameOutpoint(event.frozenInputOutpoint, prizeOutpoint, "draw input");
      validateEntropyBoundary(config, event);
      const candidateBlockHashHex = normalizeHashHex(
        event.candidateBlockHashHex,
        "candidate block hash",
        "INVALID_EVENT",
      );
      const candidateSequenceCommitmentHex = normalizeHashHex(
        event.candidateSequenceCommitmentHex,
        "candidate sequence commitment",
        "INVALID_EVENT",
      );
      const computedWinner = computeWinner(
        config,
        shards,
        frozenRootHex,
        candidateBlockHashHex,
        candidateSequenceCommitmentHex,
      );
      const observedWinnerScript = normalizeScriptHex(
        event.winnerOutputScriptPublicKeyHex,
        "winner output script",
      );
      if (observedWinnerScript !== computedWinner.entry.payoutScriptPublicKeyHex) {
        fail(
          "WINNER_MISMATCH",
          "Draw output does not pay the deterministically selected participant.",
        );
      }
      const observedReturnScript = normalizeScriptHex(
        event.returnOutputScriptPublicKeyHex,
        "draw return output script",
      );
      if (observedReturnScript !== config.returnScriptPublicKeyHex) {
        fail(
          "WINNER_MISMATCH",
          "Draw remainder does not use the return script committed before funding.",
        );
      }
      winner = {
        globalIndex: computedWinner.globalIndex,
        shardIndex: computedWinner.shardIndex,
        localIndex: computedWinner.localIndex,
        payoutScriptPublicKeyHex: computedWinner.entry.payoutScriptPublicKeyHex,
        commitmentHex: computedWinner.entry.commitmentHex,
        merkleSiblingsHex: computedWinner.siblings.map(toHex),
        candidateBlockHashHex,
        candidateSequenceCommitmentHex,
        drawTransactionId: transactionId,
      };
      terminalTransactionId = transactionId;
      prizeOutpoint = null;
      phase = "drawn";
      continue;
    }

    if (phase !== "frozen" || frozenEntryCount === null) {
      fail("INVALID_STATE", "Return requires a reconstructed frozen giveaway.");
    }
    assertSameOutpoint(event.frozenInputOutpoint, prizeOutpoint, "return input");
    const earliestReturnDaa = frozenEntryCount === 0 ? config.closesAtDaa : config.returnAtDaa;
    if (event.blockDaaScore < earliestReturnDaa) {
      fail("INVALID_STATE", "Return happened before the covenant fallback deadline.");
    }
    const observedReturnScript = normalizeScriptHex(
      event.returnOutputScriptPublicKeyHex,
      "return output script",
    );
    if (observedReturnScript !== config.returnScriptPublicKeyHex) {
      fail("INVALID_EVENT", "Return output does not use the script committed before funding.");
    }
    terminalTransactionId = transactionId;
    prizeOutpoint = null;
    phase = "returned";
  }

  return {
    phase,
    activationTransactionId,
    freezeTransactionId,
    terminalTransactionId,
    prizeOutpoint,
    observedRegistrationCount: commitments.size,
    frozenEntryCount,
    frozenRootHex,
    shards: shards.map((shard) => snapshotShard(shard, config.treeDepth)),
    winner,
  };
}

/** Converts every BigInt at the JSON boundary to a decimal string. */
export function serializeGiveawayV6Snapshot(
  snapshot: GiveawayV6ReconstructionSnapshot,
): GiveawayV6PublicSnapshot {
  const serializeEntry = (entry: GiveawayV6EntrySnapshot | null) =>
    entry === null ? null : { ...entry, registeredAtDaa: entry.registeredAtDaa.toString() };
  return {
    ...snapshot,
    shards: snapshot.shards.map((shard) => ({
      ...shard,
      finalizedEntries: shard.finalizedEntries.map((entry) => serializeEntry(entry)!),
      pendingEntry: serializeEntry(shard.pendingEntry),
      excludedLateEntry: serializeEntry(shard.excludedLateEntry),
    })),
  };
}

function normalizeConfig(config: GiveawayV6ReconstructionConfig): NormalizedConfig {
  const giveawayIdHex = normalizeHashHex(config.giveawayIdHex, "giveaway ID", "INVALID_CONFIG");
  validateU64(config.closesAtDaa, "closing DAA score", "INVALID_CONFIG");
  validateU64(config.returnAtDaa, "return DAA score", "INVALID_CONFIG");
  validateU64(config.entropyTargetBlueScore, "entropy target blue score", "INVALID_CONFIG");
  if (config.returnAtDaa <= config.closesAtDaa) {
    fail("INVALID_CONFIG", "Return DAA score must be later than the closing DAA score.");
  }
  if (!Number.isInteger(config.shardCount) || config.shardCount < 1 || config.shardCount > 4) {
    fail("INVALID_CONFIG", "Shard count must be an integer from 1 through 4.");
  }
  if (!Number.isInteger(config.treeDepth) || config.treeDepth < 1 || config.treeDepth > 16) {
    fail("INVALID_CONFIG", "Entry tree depth must be an integer from 1 through 16.");
  }
  if (
    !Number.isInteger(config.maxEntriesPerShard) ||
    config.maxEntriesPerShard < 1 ||
    config.maxEntriesPerShard > 2 ** config.treeDepth
  ) {
    fail("INVALID_CONFIG", "Maximum shard entries must fit the configured entry tree.");
  }
  return {
    ...config,
    giveawayIdHex,
    returnScriptPublicKeyHex: normalizeScriptHex(
      config.returnScriptPublicKeyHex,
      "return script",
      "INVALID_CONFIG",
    ),
  };
}

function validateEntropyBoundary(config: NormalizedConfig, event: GiveawayV6DrawEvent): void {
  normalizeHashHex(event.parentBlockHashHex, "parent block hash", "INVALID_EVENT");
  normalizeHashHex(
    event.parentSequenceCommitmentHex,
    "parent sequence commitment",
    "INVALID_EVENT",
  );
  normalizeHashHex(event.candidateBlockHashHex, "candidate block hash", "INVALID_EVENT");
  normalizeHashHex(
    event.candidateSequenceCommitmentHex,
    "candidate sequence commitment",
    "INVALID_EVENT",
  );
  validateU64(event.parentBlueScore, "parent blue score", "INVALID_EVENT");
  validateU64(event.candidateBlueScore, "candidate blue score", "INVALID_EVENT");
  if (
    event.parentBlueScore >= config.entropyTargetBlueScore ||
    event.candidateBlueScore < config.entropyTargetBlueScore ||
    event.parentBlueScore >= event.candidateBlueScore
  ) {
    fail("INVALID_EVENT", "Draw blocks do not prove the committed entropy target boundary.");
  }
}

function snapshotShard(shard: MutableShard, treeDepth: number): GiveawayV6ShardSnapshot {
  const commitments = shard.finalizedEntries.map((entry) => hexToBytes(entry.commitmentHex));
  return {
    shardIndex: shard.shardIndex,
    finalizedEntryCount: shard.finalizedEntries.length,
    entriesRootHex: toHex(entryRootAndProof(commitments, treeDepth).root),
    addressRootHex: toHex(addressRoot(shard.allCommitments)),
    finalizedEntries: shard.finalizedEntries.map((entry) => ({ ...entry })),
    pendingEntry: shard.pendingEntry === null ? null : { ...shard.pendingEntry },
    excludedLateEntry: shard.excludedLateEntry === null ? null : { ...shard.excludedLateEntry },
    tipOutpoint: shard.tipOutpoint === null ? null : { ...shard.tipOutpoint },
  };
}

function computeFrozenState(
  shards: readonly MutableShard[],
  treeDepth: number,
): {
  frozenRootHex: string;
  entryCount: number;
} {
  let aggregate = sha256(new Uint8Array());
  let entryCount = 0;
  for (const shard of shards) {
    const commitments = shard.finalizedEntries.map((entry) => hexToBytes(entry.commitmentHex));
    const entriesRoot = entryRootAndProof(commitments, treeDepth).root;
    const addressesRoot = addressRoot(shard.allCommitments);
    aggregate = sha256(
      aggregate,
      u64Le(BigInt(shard.shardIndex)),
      u64Le(BigInt(commitments.length)),
      entriesRoot,
      addressesRoot,
    );
    entryCount += commitments.length;
  }
  return { frozenRootHex: toHex(aggregate), entryCount };
}

function computeWinner(
  config: NormalizedConfig,
  shards: readonly MutableShard[],
  frozenRootHex: string,
  candidateBlockHashHex: string,
  candidateSequenceCommitmentHex: string,
): {
  globalIndex: number;
  shardIndex: number;
  localIndex: number;
  entry: GiveawayV6EntrySnapshot;
  siblings: Uint8Array[];
} {
  const entries = shards.flatMap((shard) => shard.finalizedEntries);
  if (entries.length === 0)
    fail("INVALID_STATE", "Winner selection requires at least one frozen entry.");
  const digest = sha256(
    Uint8Array.of(0x61),
    hexToBytes(config.giveawayIdHex),
    hexToBytes(frozenRootHex),
    hexToBytes(candidateBlockHashHex),
    hexToBytes(candidateSequenceCommitmentHex),
  );
  const globalIndex =
    ((digest[0]! | (digest[1]! << 8) | (digest[2]! << 16) | (digest[3]! << 24)) >>> 0) %
    entries.length;
  let remaining = globalIndex;
  for (const shard of shards) {
    if (remaining < shard.finalizedEntries.length) {
      const entry = shard.finalizedEntries[remaining]!;
      const tree = entryRootAndProof(
        shard.finalizedEntries.map((value) => hexToBytes(value.commitmentHex)),
        config.treeDepth,
        remaining,
      );
      return {
        globalIndex,
        shardIndex: shard.shardIndex,
        localIndex: remaining,
        entry,
        siblings: tree.siblings,
      };
    }
    remaining -= shard.finalizedEntries.length;
  }
  throw new Error("unreachable winner index");
}

function entryRootAndProof(
  commitments: readonly Uint8Array[],
  treeDepth: number,
  proofIndex?: number,
): { root: Uint8Array; siblings: Uint8Array[] } {
  const capacity = 2 ** treeDepth;
  if (commitments.length > capacity)
    fail("INVALID_STATE", "Entry count exceeds the configured Merkle tree capacity.");
  if (
    proofIndex !== undefined &&
    (!Number.isInteger(proofIndex) || proofIndex < 0 || proofIndex >= commitments.length)
  ) {
    fail("INVALID_STATE", "Winner proof index is outside the populated entry tree.");
  }
  const emptyLeaf = leaf(0x00, ZERO_HASH);
  let level = Array.from({ length: capacity }, (_, index) =>
    index < commitments.length ? leaf(0x01, commitments[index]!) : emptyLeaf,
  );
  let position = proofIndex ?? 0;
  const siblings: Uint8Array[] = [];
  for (let depth = 0; depth < treeDepth; depth += 1) {
    if (proofIndex !== undefined) siblings.push(level[position ^ 1]!);
    position = Math.floor(position / 2);
    const next: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      next.push(node(0x02, level[index]!, level[index + 1]!));
    }
    level = next;
  }
  return { root: level[0]!, siblings };
}

function addressRoot(commitments: readonly Uint8Array[]): Uint8Array {
  const empty: Uint8Array[] = [leaf(0x10, ZERO_HASH)];
  for (let level = 0; level < ADDRESS_TREE_DEPTH; level += 1) {
    empty.push(node(0x12, empty[level]!, empty[level]!));
  }
  let nodes = new Map<string, { position: Uint8Array; hash: Uint8Array }>();
  for (const commitment of commitments) {
    nodes.set(toHex(commitment), { position: commitment.slice(), hash: leaf(0x11, commitment) });
  }
  for (let level = 0; level < ADDRESS_TREE_DEPTH; level += 1) {
    const parents = new Map<string, { position: Uint8Array; hash: Uint8Array }>();
    const visited = new Set<string>();
    for (const key of [...nodes.keys()].sort()) {
      if (visited.has(key)) continue;
      const value = nodes.get(key)!;
      visited.add(key);
      const siblingPosition = value.position.slice();
      siblingPosition[0] = siblingPosition[0]! ^ 1;
      const siblingKey = toHex(siblingPosition);
      visited.add(siblingKey);
      const sibling = nodes.get(siblingKey)?.hash ?? empty[level]!;
      const parentHash =
        (value.position[0]! & 1) === 0
          ? node(0x12, value.hash, sibling)
          : node(0x12, sibling, value.hash);
      const parentPosition = shiftRightLittleEndian(value.position);
      parents.set(toHex(parentPosition), { position: parentPosition, hash: parentHash });
    }
    nodes = parents;
  }
  return nodes.values().next().value?.hash ?? empty[ADDRESS_TREE_DEPTH]!;
}

function shiftRightLittleEndian(value: Uint8Array): Uint8Array {
  const result = value.slice();
  let carry = 0;
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const nextCarry = result[index]! & 1;
    result[index] = (result[index]! >> 1) | (carry << 7);
    carry = nextCarry;
  }
  return result;
}

function leaf(domain: number, value: Uint8Array): Uint8Array {
  return sha256(Uint8Array.of(domain), value);
}

function node(domain: number, left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(Uint8Array.of(domain), left, right);
}

function sha256(...parts: readonly Uint8Array[]): Uint8Array {
  const digest = createHash("sha256");
  parts.forEach((part) => digest.update(part));
  return new Uint8Array(digest.digest());
}

function u64Le(value: bigint): Uint8Array {
  validateU64(value, "u64 value", "INVALID_STATE");
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function assertSameOutpoint(
  observed: GiveawayV6Outpoint,
  expected: GiveawayV6Outpoint | null,
  label: string,
): void {
  const normalized = normalizeOutpoint(observed, label);
  if (
    expected === null ||
    normalized.transactionId !== expected.transactionId ||
    normalized.outputIndex !== expected.outputIndex
  ) {
    fail("INVALID_LINEAGE", `${label} does not consume the current covenant-family output.`);
  }
}

function normalizeOutpoint(outpoint: GiveawayV6Outpoint, label: string): GiveawayV6Outpoint {
  if (typeof outpoint !== "object" || outpoint === null)
    fail("INVALID_EVENT", `${label} must be an outpoint.`);
  return {
    transactionId: normalizeHashHex(
      outpoint.transactionId,
      `${label} transaction ID`,
      "INVALID_EVENT",
    ),
    outputIndex: validateOutputIndex(outpoint.outputIndex, `${label} output index`),
  };
}

function normalizeHashHex(
  value: string,
  label: string,
  code: "INVALID_CONFIG" | "INVALID_EVENT",
): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value))
    fail(code, `${label} must be a 32-byte hex value.`);
  return value.toLowerCase();
}

function normalizeScriptHex(
  value: string,
  label: string,
  code: "INVALID_CONFIG" | "INVALID_EVENT" = "INVALID_EVENT",
): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    fail(code, `${label} must be non-empty even-length hex.`);
  }
  const byteLength = value.length / 2;
  if (byteLength < 2 || byteLength > 128) fail(code, `${label} must contain 2 through 128 bytes.`);
  return value.toLowerCase();
}

function validateOutputIndex(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    fail("INVALID_EVENT", `${label} must be a non-negative uint32.`);
  }
  return value;
}

function validateU64(
  value: bigint,
  label: string,
  code: "INVALID_CONFIG" | "INVALID_EVENT" | "INVALID_STATE",
): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U64)
    fail(code, `${label} must be an unsigned 64-bit integer.`);
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function toHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

function fail(code: GiveawayV6ReconstructionErrorCode, message: string): never {
  throw new GiveawayV6ReconstructionError(code, message);
}
