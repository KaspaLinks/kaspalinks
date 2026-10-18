import {
  buildToccataKeylessTransaction,
  type ToccataKeylessTransaction,
} from "@kaspa-actions/kaspa";
import {
  GIVEAWAY_V6_PRIZE_DISPATCH_TAGS,
  GIVEAWAY_V6_SHARD_DISPATCH_TAGS,
  buildGiveawayV6PrizeRedeemScriptHex,
  buildGiveawayV6ShardRedeemScriptHex,
  decodeGiveawayV6Witness,
  giveawayV6PayToScriptHashScriptPublicKeyHex,
  prepareGiveawayV6Winner,
  previewGiveawayV6Freeze,
  type GiveawayV6ChainEvent,
  type GiveawayV6FamilyDescriptor,
  type GiveawayV6ReconstructionConfig,
  type GiveawayV6ReconstructionSnapshot,
  GIVEAWAY_V6_FREEZE_PRIZE_COMPUTE_BUDGET,
  GIVEAWAY_V6_FREEZE_SHARD_COMPUTE_BUDGET,
  GIVEAWAY_V6_DRAW_COMPUTE_BUDGET,
  GIVEAWAY_V6_RETURN_COMPUTE_BUDGET,
} from "@kaspa-actions/kaspa-indexer";

export {
  GIVEAWAY_V6_FREEZE_PRIZE_COMPUTE_BUDGET,
  GIVEAWAY_V6_FREEZE_SHARD_COMPUTE_BUDGET,
  GIVEAWAY_V6_DRAW_COMPUTE_BUDGET,
  GIVEAWAY_V6_RETURN_COMPUTE_BUDGET,
};

const ZERO_HASH = "00".repeat(32);
const HEX_PATTERN = /^(?:[0-9a-f]{2})+$/u;

export type GiveawayV6SettlementScripts = {
  prizeRedeemScriptHex: string;
  shardTemplateRedeemScriptHex: string;
};

export type GiveawayV6EntropyBoundary = {
  parentBlockHashHex: string;
  parentBlueScore: bigint;
  parentSequenceCommitmentHex: string;
  candidateBlockHashHex: string;
  candidateBlueScore: bigint;
  candidateSequenceCommitmentHex: string;
};

export type GiveawayV6FreezeTransaction = ToccataKeylessTransaction & {
  entryCount: number;
  frozenAmountSompi: string;
  frozenRedeemScriptHex: string;
  frozenRootHex: string;
};

export type GiveawayV6ReturnTransaction = ToccataKeylessTransaction & {
  returnAmountSompi: string;
};

export type GiveawayV6DrawTransaction = ToccataKeylessTransaction & {
  returnAmountSompi: string;
  winnerGlobalIndex: number;
  winnerScriptPublicKeyHex: string;
};

/** Builds the complete-family close transition from reconstructed chain state. */
export function buildGiveawayV6FreezeTransaction(input: {
  activationBlockDaaScore: bigint;
  config: GiveawayV6ReconstructionConfig;
  events: readonly GiveawayV6ChainEvent[];
  family: GiveawayV6FamilyDescriptor;
  scripts: GiveawayV6SettlementScripts;
  snapshot: GiveawayV6ReconstructionSnapshot;
}): GiveawayV6FreezeTransaction {
  if (input.snapshot.phase !== "open") {
    throw new Error("Giveaway V6 freeze requires an open reconstructed state.");
  }
  const localPreview = previewGiveawayV6Freeze(input.config, input.events);
  if (
    localPreview.prizeInputOutpoint.transactionId !== input.snapshot.prizeOutpoint?.transactionId ||
    localPreview.prizeInputOutpoint.outputIndex !== input.snapshot.prizeOutpoint.outputIndex
  ) {
    throw new Error("Giveaway V6 freeze preview disagrees with the reconstructed Prize tip.");
  }
  const openPrizeRedeemScriptHex = buildGiveawayV6PrizeRedeemScriptHex(
    input.scripts.prizeRedeemScriptHex,
    { phase: 1, frozenRootHex: ZERO_HASH, entryCount: 0 },
  );
  const frozenRedeemScriptHex = buildGiveawayV6PrizeRedeemScriptHex(openPrizeRedeemScriptHex, {
    phase: 2,
    frozenRootHex: localPreview.frozenRootHex,
    entryCount: localPreview.entryCount,
  });
  const shardInputs = input.snapshot.shards.map((shard) => {
    if (shard.tipOutpoint === null) throw new Error("Giveaway V6 shard tip is missing.");
    const registrations = shard.finalizedEntryCount + (shard.pendingEntry === null ? 0 : 1);
    const amountSompi =
      input.family.shardValueSompi - BigInt(registrations) * input.family.entryFeeSompi;
    if (amountSompi <= 0n) throw new Error("Giveaway V6 shard reserve is exhausted.");
    const redeemScriptHex = buildGiveawayV6ShardRedeemScriptHex(
      input.scripts.shardTemplateRedeemScriptHex,
      {
        shardIndex: shard.shardIndex,
        count: shard.finalizedEntryCount,
        entriesRootHex: shard.entriesRootHex,
        addressRootHex: shard.addressRootHex,
        pendingHashHex: shard.pendingEntry?.commitmentHex ?? ZERO_HASH,
      },
    );
    return {
      computeBudget: GIVEAWAY_V6_FREEZE_SHARD_COMPUTE_BUDGET,
      funding: {
        amountSompi,
        blockDaaScore: shard.pendingEntry?.registeredAtDaa ?? input.activationBlockDaaScore,
        outputIndex: shard.tipOutpoint.outputIndex,
        scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(redeemScriptHex),
        transactionId: shard.tipOutpoint.transactionId,
      },
      invocationStackHex: [GIVEAWAY_V6_SHARD_DISPATCH_TAGS.delegateFreeze],
      redeemScriptHex,
    };
  });
  const familyAmountSompi =
    input.family.prizeValueSompi +
    shardInputs.reduce((sum, shard) => sum + BigInt(shard.funding.amountSompi), 0n);
  const frozenAmountSompi = familyAmountSompi - input.family.freezeFeeSompi;
  if (frozenAmountSompi <= 0n) throw new Error("Giveaway V6 family cannot cover the freeze fee.");
  if (input.snapshot.prizeOutpoint === null) throw new Error("Giveaway V6 Prize tip is missing.");

  const transaction = buildToccataKeylessTransaction({
    feeSompi: input.family.freezeFeeSompi,
    inputs: [
      {
        computeBudget: GIVEAWAY_V6_FREEZE_PRIZE_COMPUTE_BUDGET,
        funding: {
          amountSompi: input.family.prizeValueSompi,
          blockDaaScore: input.activationBlockDaaScore,
          outputIndex: input.snapshot.prizeOutpoint.outputIndex,
          scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(openPrizeRedeemScriptHex),
          transactionId: input.snapshot.prizeOutpoint.transactionId,
        },
        invocationStackHex: [
          localPreview.pendingSiblingsHex.join(""),
          GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.freeze,
        ],
        redeemScriptHex: openPrizeRedeemScriptHex,
      },
      ...shardInputs,
    ],
    lockTime: input.config.closesAtDaa,
    outputs: [
      {
        amountSompi: frozenAmountSompi,
        covenant: { authorizingInput: 0, covenantIdHex: input.family.covenantIdHex },
        scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(frozenRedeemScriptHex),
      },
    ],
  });
  assertFreezeWitnesses(transaction, input, localPreview);
  return {
    ...transaction,
    entryCount: localPreview.entryCount,
    frozenAmountSompi: frozenAmountSompi.toString(),
    frozenRedeemScriptHex,
    frozenRootHex: localPreview.frozenRootHex,
  };
}

/** Builds the covenant-restricted return for an empty or expired frozen Giveaway. */
export function buildGiveawayV6ReturnTransaction(input: {
  config: GiveawayV6ReconstructionConfig;
  family: GiveawayV6FamilyDescriptor;
  freezeBlockDaaScore: bigint;
  scripts: GiveawayV6SettlementScripts;
  snapshot: GiveawayV6ReconstructionSnapshot;
}): GiveawayV6ReturnTransaction {
  const frozen = restoreFrozenInput(input);
  const returnAmountSompi = frozen.amountSompi - input.family.returnFeeSompi;
  if (returnAmountSompi <= 0n) throw new Error("Giveaway V6 reserve cannot cover the return fee.");
  const earliestDaa =
    input.snapshot.frozenEntryCount === 0 ? input.config.closesAtDaa : input.config.returnAtDaa;
  const transaction = buildToccataKeylessTransaction({
    feeSompi: input.family.returnFeeSompi,
    inputs: [
      {
        computeBudget: GIVEAWAY_V6_RETURN_COMPUTE_BUDGET,
        funding: {
          amountSompi: frozen.amountSompi,
          blockDaaScore: input.freezeBlockDaaScore,
          outputIndex: input.snapshot.prizeOutpoint!.outputIndex,
          scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(frozen.redeemScriptHex),
          transactionId: input.snapshot.prizeOutpoint!.transactionId,
        },
        invocationStackHex: [GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.returnFunds],
        redeemScriptHex: frozen.redeemScriptHex,
      },
    ],
    lockTime: earliestDaa,
    outputs: [
      { amountSompi: returnAmountSompi, scriptPublicKeyHex: input.config.returnScriptPublicKeyHex },
    ],
  });
  const witness = decodeGiveawayV6Witness(transaction.inputs[0]!.signatureScriptHex);
  if (witness.contract !== "prize" || witness.method !== "returnFunds") {
    throw new Error("Giveaway V6 return witness disagrees with the reconstructed state.");
  }
  return { ...transaction, returnAmountSompi: returnAmountSompi.toString() };
}

/** Builds the proof-bound winner payout and exact committed-address remainder. */
export function buildGiveawayV6DrawTransaction(input: {
  compactProofHex: string;
  config: GiveawayV6ReconstructionConfig;
  entropy: GiveawayV6EntropyBoundary;
  family: GiveawayV6FamilyDescriptor;
  freezeBlockDaaScore: bigint;
  scripts: GiveawayV6SettlementScripts;
  snapshot: GiveawayV6ReconstructionSnapshot;
}): GiveawayV6DrawTransaction {
  const frozen = restoreFrozenInput(input);
  if (input.snapshot.frozenEntryCount === 0) {
    throw new Error("An empty Giveaway V6 cannot be drawn.");
  }
  validateEntropyBoundary(input.config, input.entropy);
  const proofHex = normalizeHex(input.compactProofHex, "compact entropy proof", 250_000);
  const winner = prepareGiveawayV6Winner({
    config: input.config,
    snapshot: input.snapshot,
    candidateBlockHashHex: input.entropy.candidateBlockHashHex,
    candidateSequenceCommitmentHex: input.entropy.candidateSequenceCommitmentHex,
  });
  const returnAmountSompi =
    frozen.amountSompi - input.family.prizeValueSompi - input.family.drawFeeSompi;
  if (returnAmountSompi <= 0n) throw new Error("Giveaway V6 reserve cannot cover the draw.");
  const transaction = buildToccataKeylessTransaction({
    feeSompi: input.family.drawFeeSompi,
    inputs: [
      {
        computeBudget: GIVEAWAY_V6_DRAW_COMPUTE_BUDGET,
        funding: {
          amountSompi: frozen.amountSompi,
          blockDaaScore: input.freezeBlockDaaScore,
          outputIndex: input.snapshot.prizeOutpoint!.outputIndex,
          scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(frozen.redeemScriptHex),
          transactionId: input.snapshot.prizeOutpoint!.transactionId,
        },
        invocationStackHex: [
          proofHex,
          normalizeHash(input.entropy.parentBlockHashHex, "parent block hash"),
          scriptInt(input.entropy.parentBlueScore),
          normalizeHash(input.entropy.candidateBlockHashHex, "candidate block hash"),
          scriptInt(input.entropy.candidateBlueScore),
          input.snapshot.shards.map((shard) => u64Le(BigInt(shard.finalizedEntryCount))).join(""),
          input.snapshot.shards.map((shard) => shard.entriesRootHex).join(""),
          input.snapshot.shards.map((shard) => shard.addressRootHex).join(""),
          winner.payoutScriptPublicKeyHex,
          winner.merkleSiblingsHex.join(""),
          GIVEAWAY_V6_PRIZE_DISPATCH_TAGS.draw,
        ],
        redeemScriptHex: frozen.redeemScriptHex,
      },
    ],
    outputs: [
      {
        amountSompi: input.family.prizeValueSompi,
        scriptPublicKeyHex: winner.payoutScriptPublicKeyHex,
      },
      { amountSompi: returnAmountSompi, scriptPublicKeyHex: input.config.returnScriptPublicKeyHex },
    ],
  });
  const witness = decodeGiveawayV6Witness(transaction.inputs[0]!.signatureScriptHex);
  if (
    witness.contract !== "prize" ||
    witness.method !== "draw" ||
    witness.winnerScriptPublicKeyHex !== winner.payoutScriptPublicKeyHex ||
    witness.parentBlockHashHex !== input.entropy.parentBlockHashHex.toLowerCase() ||
    witness.candidateBlockHashHex !== input.entropy.candidateBlockHashHex.toLowerCase()
  ) {
    throw new Error("Giveaway V6 draw witness disagrees with the reconstructed winner.");
  }
  return {
    ...transaction,
    returnAmountSompi: returnAmountSompi.toString(),
    winnerGlobalIndex: winner.globalIndex,
    winnerScriptPublicKeyHex: winner.payoutScriptPublicKeyHex,
  };
}

function restoreFrozenInput(input: {
  family: GiveawayV6FamilyDescriptor;
  scripts: GiveawayV6SettlementScripts;
  snapshot: GiveawayV6ReconstructionSnapshot;
}) {
  if (
    input.snapshot.phase !== "frozen" ||
    input.snapshot.prizeOutpoint === null ||
    input.snapshot.frozenRootHex === null ||
    input.snapshot.frozenEntryCount === null
  ) {
    throw new Error("Giveaway V6 settlement requires a frozen reconstructed state.");
  }
  const amountSompi =
    input.family.prizeValueSompi +
    BigInt(input.snapshot.shards.length) * input.family.shardValueSompi -
    BigInt(input.snapshot.observedRegistrationCount) * input.family.entryFeeSompi -
    input.family.freezeFeeSompi;
  const redeemScriptHex = buildGiveawayV6PrizeRedeemScriptHex(input.scripts.prizeRedeemScriptHex, {
    phase: 2,
    frozenRootHex: input.snapshot.frozenRootHex,
    entryCount: input.snapshot.frozenEntryCount,
  });
  return { amountSompi, redeemScriptHex };
}

function assertFreezeWitnesses(
  transaction: ToccataKeylessTransaction,
  input: { config: GiveawayV6ReconstructionConfig },
  preview: { entryCount: number; frozenRootHex: string },
) {
  const prize = decodeGiveawayV6Witness(transaction.inputs[0]!.signatureScriptHex);
  if (
    prize.contract !== "prize" ||
    prize.method !== "freeze" ||
    prize.pendingSiblingCount !== input.config.shardCount * input.config.treeDepth ||
    prize.state.phase !== 1
  ) {
    throw new Error("Giveaway V6 freeze witness disagrees with the reconstructed state.");
  }
  for (const candidate of transaction.inputs.slice(1)) {
    const shard = decodeGiveawayV6Witness(candidate.signatureScriptHex);
    if (shard.contract !== "shard" || shard.method !== "delegateFreeze") {
      throw new Error("Giveaway V6 shard freeze witness is invalid.");
    }
  }
  if (preview.entryCount < 0 || !/^[0-9a-f]{64}$/u.test(preview.frozenRootHex)) {
    throw new Error("Giveaway V6 freeze preview is invalid.");
  }
}

function validateEntropyBoundary(
  config: GiveawayV6ReconstructionConfig,
  entropy: GiveawayV6EntropyBoundary,
) {
  normalizeHash(entropy.parentBlockHashHex, "parent block hash");
  normalizeHash(entropy.parentSequenceCommitmentHex, "parent sequence commitment");
  normalizeHash(entropy.candidateBlockHashHex, "candidate block hash");
  normalizeHash(entropy.candidateSequenceCommitmentHex, "candidate sequence commitment");
  if (
    entropy.parentBlueScore < 0n ||
    entropy.parentBlueScore >= config.entropyTargetBlueScore ||
    entropy.candidateBlueScore < config.entropyTargetBlueScore ||
    entropy.parentBlueScore >= entropy.candidateBlueScore
  ) {
    throw new Error("Giveaway V6 entropy boundary does not cross the committed target.");
  }
}

function normalizeHash(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/u.test(normalized)) throw new Error(`${label} must be 32-byte hex.`);
  return normalized;
}

function normalizeHex(value: string, label: string, maximumBytes: number): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!HEX_PATTERN.test(normalized) || normalized.length / 2 > maximumBytes) {
    throw new Error(`${label} must be bounded even-length hex.`);
  }
  return normalized;
}

function u64Le(value: bigint): string {
  if (value < 0n || value > (1n << 64n) - 1n) throw new Error("Value must fit uint64.");
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes.toString("hex");
}

function scriptInt(value: bigint): string {
  if (value < 0n || value > (1n << 63n) - 1n) throw new Error("Script int is out of range.");
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0n) {
    bytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  if ((bytes.at(-1) ?? 0) & 0x80) bytes.push(0);
  return Buffer.from(bytes).toString("hex") || "00";
}
