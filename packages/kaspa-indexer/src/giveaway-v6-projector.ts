import type {
  GiveawayV6ChainEvent,
  GiveawayV6Outpoint,
  GiveawayV6ReconstructionConfig,
  GiveawayV6ReconstructionSnapshot,
  GiveawayV6ShardSnapshot,
} from "./giveaway-v6-reconstructor";
import { previewGiveawayV6Freeze, reconstructGiveawayV6 } from "./giveaway-v6-reconstructor";
import type {
  GiveawayV6DecodedWitness,
  GiveawayV6PrizeState,
  GiveawayV6ShardState,
} from "./giveaway-v6-witness";
import {
  buildGiveawayV6InitialShardRedeemScriptHex,
  buildGiveawayV6PrizeRedeemScriptHex,
  buildGiveawayV6ShardRedeemScriptHex,
  decodeGiveawayV6Witness,
  giveawayV6PayToScriptHashScriptPublicKeyHex,
  giveawayV6TemplateHashHex,
} from "./giveaway-v6-witness";
import type {
  KaspaVspcAcceptedTransaction,
  KaspaVspcHeader,
  KaspaVspcInput,
  KaspaVspcOutput,
} from "./kaspa-vspc-v2";
import { deriveGiveawayV6GenesisCovenantIdHex } from "./giveaway-v6-covenant-id";

const MAX_U64 = (1n << 64n) - 1n;
const ZERO_HASH_HEX = "00".repeat(32);

export type GiveawayV6FamilyDescriptor = {
  genesisOutpoint: GiveawayV6Outpoint;
  covenantIdHex: string;
  prizeTemplateHashHex: string;
  shardTemplateHashHex: string;
  prizeValueSompi: bigint;
  shardValueSompi: bigint;
  entryFeeSompi: bigint;
  activationFeeSompi: bigint;
  freezeFeeSompi: bigint;
  drawFeeSompi: bigint;
  returnFeeSompi: bigint;
};

export type ProjectGiveawayV6ChainInput = {
  config: GiveawayV6ReconstructionConfig;
  family: GiveawayV6FamilyDescriptor;
  /** Previously verified transitions retained by an idempotent projection worker. */
  initialEvents?: readonly GiveawayV6ChainEvent[];
  /** Accepted transactions in selected-chain order, supplied by VSPC v2 Full. */
  transactions: readonly KaspaVspcAcceptedTransaction[];
  /** Headers needed to independently bind a draw to its entropy boundary. */
  headers: readonly KaspaVspcHeader[];
};

export type GiveawayV6ChainProjection = {
  events: readonly GiveawayV6ChainEvent[];
  snapshot: GiveawayV6ReconstructionSnapshot;
  ignoredTransactionCount: number;
};

export type GiveawayV6ProjectionErrorCode =
  | "INVALID_FAMILY"
  | "INVALID_TRANSITION"
  | "MISSING_HEADER";

export class GiveawayV6ProjectionError extends Error {
  readonly code: GiveawayV6ProjectionErrorCode;

  constructor(code: GiveawayV6ProjectionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GiveawayV6ProjectionError";
    this.code = code;
  }
}

/**
 * Projects one Giveaway V6 covenant family exclusively from confirmed public
 * chain data. A database row may locate the family, but it cannot add an
 * entrant, alter a state output, or choose a winner.
 */
export function projectGiveawayV6Chain(
  input: ProjectGiveawayV6ChainInput,
): GiveawayV6ChainProjection {
  const family = normalizeFamily(input.family);
  const headers = indexHeaders(input.headers);
  const events: GiveawayV6ChainEvent[] = [...(input.initialEvents ?? [])];
  let ignoredTransactionCount = 0;

  // Also validates a restart checkpoint before new chain data is accepted.
  let snapshot = reconstructGiveawayV6(input.config, events);
  validateFamilyEconomics(input.config, family);

  for (const transaction of input.transactions) {
    validateNormalizedTransaction(transaction);
    const consumesGenesis =
      snapshot.phase === "awaiting_activation" &&
      transaction.inputs.some((value) =>
        outpointsEqual(value.previousOutpoint, family.genesisOutpoint),
      );
    const familyInputIndexes = transaction.inputs.flatMap((value, index) =>
      value.utxo.covenantIdHex === family.covenantIdHex ? [index] : [],
    );
    if (!consumesGenesis && familyInputIndexes.length === 0) {
      ignoredTransactionCount += 1;
      continue;
    }
    if (!consumesGenesis && familyInputIndexes.length !== transaction.inputs.length) {
      invalid("A Giveaway V6 transition cannot mix inputs from another covenant family.");
    }
    if (transaction.version !== 1) invalid("Giveaway V6 covenant transactions must use version 1.");

    const witnesses = transaction.inputs.map((txInput, index) =>
      decodeFamilyWitness(txInput, index, family),
    );

    let event: GiveawayV6ChainEvent;
    if (snapshot.phase === "awaiting_activation") {
      event = projectActivation(transaction, witnesses, input.config, family);
    } else {
      const first = witnesses[0]!;
      if (first.contract === "shard" && first.method === "register") {
        event = projectRegistration(transaction, witnesses, input.config, events, snapshot, family);
      } else if (first.contract === "prize" && first.method === "freeze") {
        event = projectFreeze(transaction, witnesses, input.config, events, snapshot, family);
      } else if (first.contract === "prize" && first.method === "draw") {
        event = projectDraw(transaction, witnesses, input.config, snapshot, family, headers);
      } else if (first.contract === "prize" && first.method === "returnFunds") {
        event = projectReturn(transaction, witnesses, input.config, snapshot, family);
      } else {
        invalid("The covenant family was spent through an unexpected V6 transition.");
      }
    }

    events.push(event);
    try {
      snapshot = reconstructGiveawayV6(input.config, events);
    } catch (error) {
      events.pop();
      throw new GiveawayV6ProjectionError(
        "INVALID_TRANSITION",
        `Accepted family transaction ${transaction.transactionId} breaks the reconstructed lineage.`,
        { cause: error },
      );
    }
  }

  return { events, snapshot, ignoredTransactionCount };
}

function projectActivation(
  transaction: KaspaVspcAcceptedTransaction,
  witnesses: readonly GiveawayV6DecodedWitness[],
  config: GiveawayV6ReconstructionConfig,
  family: NormalizedFamily,
): GiveawayV6ChainEvent {
  requireShape(transaction, 1, config.shardCount + 1, witnesses);
  const witness = witnesses[0]!;
  if (witness.contract !== "prize" || witness.method !== "activate") {
    invalid("The first family spend must call the Prize activation entry.");
  }
  assertOutpoint(transaction.inputs[0]!.previousOutpoint, family.genesisOutpoint, "genesis input");
  if (transaction.inputs[0]!.utxo.covenantIdHex !== null) {
    invalid(
      "Activation must spend an ordinary bootstrap output before creating the covenant family.",
    );
  }
  assertPrizeState(witness.state, { phase: 0, frozenRootHex: ZERO_HASH_HEX, entryCount: 0 });
  assertTemplate(witness.templateHashHex, family.prizeTemplateHashHex, "Prize");

  const expectedInput = checkedSum(
    family.prizeValueSompi,
    BigInt(config.shardCount) * family.shardValueSompi,
    family.activationFeeSompi,
  );
  if (transaction.inputs[0]!.utxo.amountSompi !== expectedInput) {
    invalid("Activation input value does not match the committed prize, shard reserve, and fee.");
  }
  const derivedCovenantId = deriveGiveawayV6GenesisCovenantIdHex(
    family.genesisOutpoint,
    transaction.outputs,
  );
  if (derivedCovenantId !== family.covenantIdHex) {
    invalid(
      `Activation outputs derive covenant ID ${derivedCovenantId}, not the registered family ID.`,
    );
  }

  const event: GiveawayV6ChainEvent = {
    kind: "activate",
    transactionId: transaction.transactionId,
    blockDaaScore: transaction.acceptingDaaScore,
    prizeOutputIndex: 0,
    shardOutputIndexes: Array.from({ length: config.shardCount }, (_, index) => index + 1),
  };
  const activated = reconstructGiveawayV6(config, [event]);
  const prizeRedeem = buildGiveawayV6PrizeRedeemScriptHex(witness.redeemScriptHex, {
    phase: 1,
    frozenRootHex: ZERO_HASH_HEX,
    entryCount: 0,
  });
  assertFamilyOutput(
    transaction.outputs[0]!,
    0,
    0,
    family,
    family.prizeValueSompi,
    giveawayV6PayToScriptHashScriptPublicKeyHex(prizeRedeem),
  );

  activated.shards.forEach((shard, index) => {
    const shardRedeem = buildGiveawayV6InitialShardRedeemScriptHex(
      witness.shardPrefixHex,
      expectedShardState(shard),
      witness.shardSuffixHex,
    );
    assertTemplate(
      giveawayV6TemplateHashHex("shard", shardRedeem),
      family.shardTemplateHashHex,
      "Shard",
    );
    assertFamilyOutput(
      transaction.outputs[index + 1]!,
      index + 1,
      0,
      family,
      family.shardValueSompi,
      giveawayV6PayToScriptHashScriptPublicKeyHex(shardRedeem),
    );
  });
  return event;
}

function projectRegistration(
  transaction: KaspaVspcAcceptedTransaction,
  witnesses: readonly GiveawayV6DecodedWitness[],
  config: GiveawayV6ReconstructionConfig,
  events: readonly GiveawayV6ChainEvent[],
  snapshot: GiveawayV6ReconstructionSnapshot,
  family: NormalizedFamily,
): GiveawayV6ChainEvent {
  requireShape(transaction, 1, 1, witnesses);
  const witness = witnesses[0]!;
  if (witness.contract !== "shard" || witness.method !== "register") {
    invalid("Registration must call the Shard register entry.");
  }
  assertTemplate(witness.templateHashHex, family.shardTemplateHashHex, "Shard");
  const shard = snapshot.shards[witness.state.shardIndex];
  if (shard === undefined) invalid("Registration selected a shard outside this family.");
  assertShardState(witness.state, expectedShardState(shard));
  assertOutpoint(transaction.inputs[0]!.previousOutpoint, shard.tipOutpoint, "shard tip");
  assertPendingUtxoDaa(transaction.inputs[0]!, shard);
  if (transaction.inputs[0]!.utxo.amountSompi <= family.entryFeeSompi) {
    invalid("Shard reserve is too small for the registration fee.");
  }
  const outputValue = transaction.inputs[0]!.utxo.amountSompi - family.entryFeeSompi;

  const event: GiveawayV6ChainEvent = {
    kind: "register",
    transactionId: transaction.transactionId,
    blockDaaScore: transaction.acceptingDaaScore,
    shardIndex: witness.state.shardIndex,
    consumedOutpoint: transaction.inputs[0]!.previousOutpoint,
    producedOutputIndex: 0,
    payoutScriptPublicKeyHex: witness.payoutScriptPublicKeyHex,
  };
  let projected: GiveawayV6ReconstructionSnapshot;
  try {
    projected = reconstructGiveawayV6(config, [...events, event]);
  } catch (error) {
    throw new GiveawayV6ProjectionError(
      "INVALID_TRANSITION",
      "Registration does not satisfy the reconstructed participant lineage.",
      { cause: error },
    );
  }
  const nextShard = projected.shards[witness.state.shardIndex]!;
  const outputRedeem = buildGiveawayV6ShardRedeemScriptHex(
    witness.redeemScriptHex,
    expectedShardState(nextShard),
  );
  assertFamilyOutput(
    transaction.outputs[0]!,
    0,
    0,
    family,
    outputValue,
    giveawayV6PayToScriptHashScriptPublicKeyHex(outputRedeem),
  );
  return event;
}

function projectFreeze(
  transaction: KaspaVspcAcceptedTransaction,
  witnesses: readonly GiveawayV6DecodedWitness[],
  config: GiveawayV6ReconstructionConfig,
  events: readonly GiveawayV6ChainEvent[],
  snapshot: GiveawayV6ReconstructionSnapshot,
  family: NormalizedFamily,
): GiveawayV6ChainEvent {
  requireShape(transaction, config.shardCount + 1, 1, witnesses);
  const prizeWitness = witnesses[0]!;
  if (prizeWitness.contract !== "prize" || prizeWitness.method !== "freeze") {
    invalid("Freeze input zero must call the Prize freeze entry.");
  }
  assertTemplate(prizeWitness.templateHashHex, family.prizeTemplateHashHex, "Prize");
  assertPrizeState(prizeWitness.state, {
    phase: 1,
    frozenRootHex: ZERO_HASH_HEX,
    entryCount: 0,
  });
  if (prizeWitness.pendingSiblingCount !== config.shardCount * config.treeDepth) {
    invalid("Freeze pending-proof length does not match all configured shards.");
  }

  const preview = previewGiveawayV6Freeze(config, events);
  assertOutpoint(transaction.inputs[0]!.previousOutpoint, preview.prizeInputOutpoint, "Prize tip");
  for (let index = 0; index < config.shardCount; index += 1) {
    const witness = witnesses[index + 1]!;
    if (witness.contract !== "shard" || witness.method !== "delegateFreeze") {
      invalid(`Freeze input ${index + 1} must delegate from Shard ${index}.`);
    }
    assertTemplate(witness.templateHashHex, family.shardTemplateHashHex, "Shard");
    const shard = snapshot.shards[index]!;
    assertShardState(witness.state, expectedShardState(shard));
    assertPendingUtxoDaa(transaction.inputs[index + 1]!, shard);
    assertOutpoint(
      transaction.inputs[index + 1]!.previousOutpoint,
      preview.shardInputOutpoints[index]!,
      `Shard ${index} tip`,
    );
  }

  const inputValue = transaction.inputs.reduce(
    (total, txInput) => checkedSum(total, txInput.utxo.amountSompi),
    0n,
  );
  if (inputValue <= family.freezeFeeSompi)
    invalid("Family reserve is too small for the freeze fee.");
  const frozenRedeem = buildGiveawayV6PrizeRedeemScriptHex(prizeWitness.redeemScriptHex, {
    phase: 2,
    frozenRootHex: preview.frozenRootHex,
    entryCount: preview.entryCount,
  });
  assertFamilyOutput(
    transaction.outputs[0]!,
    0,
    0,
    family,
    inputValue - family.freezeFeeSompi,
    giveawayV6PayToScriptHashScriptPublicKeyHex(frozenRedeem),
  );
  return {
    kind: "freeze",
    transactionId: transaction.transactionId,
    blockDaaScore: transaction.acceptingDaaScore,
    prizeInputOutpoint: transaction.inputs[0]!.previousOutpoint,
    shardInputOutpoints: transaction.inputs.slice(1).map((value) => value.previousOutpoint),
    frozenOutputIndex: 0,
    observedFrozenRootHex: preview.frozenRootHex,
    observedEntryCount: preview.entryCount,
  };
}

function projectDraw(
  transaction: KaspaVspcAcceptedTransaction,
  witnesses: readonly GiveawayV6DecodedWitness[],
  config: GiveawayV6ReconstructionConfig,
  snapshot: GiveawayV6ReconstructionSnapshot,
  family: NormalizedFamily,
  headers: ReadonlyMap<string, KaspaVspcHeader>,
): GiveawayV6ChainEvent {
  requireShape(transaction, 1, 2, witnesses);
  const witness = witnesses[0]!;
  if (witness.contract !== "prize" || witness.method !== "draw") {
    invalid("Draw must call the Prize draw entry.");
  }
  assertTemplate(witness.templateHashHex, family.prizeTemplateHashHex, "Prize");
  assertFrozenPrizeState(witness.state, snapshot);
  assertOutpoint(
    transaction.inputs[0]!.previousOutpoint,
    snapshot.prizeOutpoint,
    "frozen Prize tip",
  );
  if (witness.winnerSiblingCount !== config.treeDepth) {
    invalid("Winner proof length does not match the configured entry tree.");
  }
  if (
    witness.shardCounts.length !== config.shardCount ||
    witness.shardEntriesRootsHex.length !== config.shardCount ||
    witness.shardAddressRootsHex.length !== config.shardCount
  ) {
    invalid("Draw does not disclose the complete frozen shard state.");
  }
  snapshot.shards.forEach((shard, index) => {
    if (
      witness.shardCounts[index] !== shard.finalizedEntryCount ||
      witness.shardEntriesRootsHex[index] !== shard.entriesRootHex ||
      witness.shardAddressRootsHex[index] !== shard.addressRootHex
    ) {
      invalid(`Draw shard ${index} does not match the reconstructed frozen state.`);
    }
  });

  const parent = requireHeader(headers, witness.parentBlockHashHex, "parent");
  const candidate = requireHeader(headers, witness.candidateBlockHashHex, "candidate");
  if (
    parent.blueScore !== witness.parentBlueScore ||
    candidate.blueScore !== witness.candidateBlueScore ||
    candidate.selectedParentHash !== parent.hash ||
    !candidate.directParentHashes.includes(parent.hash)
  ) {
    invalid("Draw headers do not prove the selected-parent entropy boundary.");
  }
  transaction.outputs.forEach(assertPlainOutput);
  const inputValue = transaction.inputs[0]!.utxo.amountSompi;
  const required = checkedSum(family.prizeValueSompi, family.drawFeeSompi);
  if (inputValue <= required) invalid("Frozen reserve is too small for prize and draw fee.");
  assertOutput(
    transaction.outputs[0]!,
    0,
    family.prizeValueSompi,
    witness.winnerScriptPublicKeyHex,
  );
  assertOutput(transaction.outputs[1]!, 1, inputValue - required, config.returnScriptPublicKeyHex);
  return {
    kind: "draw",
    transactionId: transaction.transactionId,
    blockDaaScore: transaction.acceptingDaaScore,
    frozenInputOutpoint: transaction.inputs[0]!.previousOutpoint,
    parentBlockHashHex: parent.hash,
    parentBlueScore: parent.blueScore,
    parentSequenceCommitmentHex: parent.acceptedIdMerkleRoot,
    candidateBlockHashHex: candidate.hash,
    candidateBlueScore: candidate.blueScore,
    candidateSequenceCommitmentHex: candidate.acceptedIdMerkleRoot,
    winnerOutputScriptPublicKeyHex: transaction.outputs[0]!.scriptPublicKeyHex,
    returnOutputScriptPublicKeyHex: transaction.outputs[1]!.scriptPublicKeyHex,
  };
}

function projectReturn(
  transaction: KaspaVspcAcceptedTransaction,
  witnesses: readonly GiveawayV6DecodedWitness[],
  config: GiveawayV6ReconstructionConfig,
  snapshot: GiveawayV6ReconstructionSnapshot,
  family: NormalizedFamily,
): GiveawayV6ChainEvent {
  requireShape(transaction, 1, 1, witnesses);
  const witness = witnesses[0]!;
  if (witness.contract !== "prize" || witness.method !== "returnFunds") {
    invalid("Return must call the Prize return entry.");
  }
  assertTemplate(witness.templateHashHex, family.prizeTemplateHashHex, "Prize");
  assertFrozenPrizeState(witness.state, snapshot);
  assertOutpoint(
    transaction.inputs[0]!.previousOutpoint,
    snapshot.prizeOutpoint,
    "frozen Prize tip",
  );
  assertPlainOutput(transaction.outputs[0]!);
  const inputValue = transaction.inputs[0]!.utxo.amountSompi;
  if (inputValue <= family.returnFeeSompi)
    invalid("Frozen reserve is too small for the return fee.");
  assertOutput(
    transaction.outputs[0]!,
    0,
    inputValue - family.returnFeeSompi,
    config.returnScriptPublicKeyHex,
  );
  return {
    kind: "return",
    transactionId: transaction.transactionId,
    blockDaaScore: transaction.acceptingDaaScore,
    frozenInputOutpoint: transaction.inputs[0]!.previousOutpoint,
    returnOutputScriptPublicKeyHex: transaction.outputs[0]!.scriptPublicKeyHex,
  };
}

type NormalizedFamily = GiveawayV6FamilyDescriptor & {
  genesisOutpoint: GiveawayV6Outpoint;
  covenantIdHex: string;
  prizeTemplateHashHex: string;
  shardTemplateHashHex: string;
};

function normalizeFamily(value: GiveawayV6FamilyDescriptor): NormalizedFamily {
  const amounts = [
    ["prize", value.prizeValueSompi],
    ["shard", value.shardValueSompi],
    ["entry fee", value.entryFeeSompi],
    ["activation fee", value.activationFeeSompi],
    ["freeze fee", value.freezeFeeSompi],
    ["draw fee", value.drawFeeSompi],
    ["return fee", value.returnFeeSompi],
  ] as const;
  for (const [label, amount] of amounts) {
    if (typeof amount !== "bigint" || amount <= 0n || amount > MAX_U64) {
      familyError(`${label} must be a positive uint64 sompi amount.`);
    }
  }
  return {
    ...value,
    genesisOutpoint: normalizeOutpoint(value.genesisOutpoint, "genesis outpoint"),
    covenantIdHex: normalizeHash(value.covenantIdHex, "covenant ID"),
    prizeTemplateHashHex: normalizeHash(value.prizeTemplateHashHex, "Prize template hash"),
    shardTemplateHashHex: normalizeHash(value.shardTemplateHashHex, "Shard template hash"),
  };
}

function validateFamilyEconomics(
  config: GiveawayV6ReconstructionConfig,
  family: NormalizedFamily,
): void {
  checkedSum(
    family.prizeValueSompi,
    BigInt(config.shardCount) * family.shardValueSompi,
    family.activationFeeSompi,
  );
  const maximumRegistrationSpend = BigInt(config.maxEntriesPerShard) * family.entryFeeSompi;
  if (maximumRegistrationSpend > MAX_U64) {
    familyError("Maximum shard registration spend exceeds uint64.");
  }
  if (family.shardValueSompi <= maximumRegistrationSpend) {
    familyError("Shard reserve must remain positive at the configured participant cap.");
  }
  const minimumRemainingReserve =
    BigInt(config.shardCount) * (family.shardValueSompi - maximumRegistrationSpend);
  if (minimumRemainingReserve > MAX_U64) {
    familyError("Minimum remaining execution reserve exceeds uint64.");
  }
  if (
    minimumRemainingReserve <= checkedSum(family.freezeFeeSompi, family.drawFeeSompi) ||
    minimumRemainingReserve <= checkedSum(family.freezeFeeSompi, family.returnFeeSompi)
  ) {
    familyError("Execution reserve cannot cover the committed terminal transaction fees.");
  }
}

function indexHeaders(headers: readonly KaspaVspcHeader[]): ReadonlyMap<string, KaspaVspcHeader> {
  const indexed = new Map<string, KaspaVspcHeader>();
  for (const header of headers) {
    const hash = normalizeHash(header.hash, "header hash");
    if (indexed.has(hash)) familyError("Header collection contains a duplicate block hash.");
    indexed.set(hash, header);
  }
  return indexed;
}

function decodeFamilyWitness(
  input: KaspaVspcInput,
  inputIndex: number,
  family: NormalizedFamily,
): GiveawayV6DecodedWitness {
  try {
    const witness = decodeGiveawayV6Witness(input.signatureScriptHex);
    const expectedScript = giveawayV6PayToScriptHashScriptPublicKeyHex(witness.redeemScriptHex);
    if (input.utxo.scriptPublicKeyHex !== expectedScript) {
      invalid(`Input ${inputIndex} redeem script does not hash to its spent script public key.`);
    }
    const expectedTemplate =
      witness.contract === "prize" ? family.prizeTemplateHashHex : family.shardTemplateHashHex;
    assertTemplate(witness.templateHashHex, expectedTemplate, witness.contract);
    return witness;
  } catch (error) {
    if (error instanceof GiveawayV6ProjectionError) throw error;
    throw new GiveawayV6ProjectionError(
      "INVALID_TRANSITION",
      `Input ${inputIndex} does not contain a valid Giveaway V6 witness.`,
      { cause: error },
    );
  }
}

function requireShape(
  transaction: KaspaVspcAcceptedTransaction,
  inputCount: number,
  outputCount: number,
  witnesses: readonly GiveawayV6DecodedWitness[],
): void {
  if (
    transaction.inputs.length !== inputCount ||
    witnesses.length !== inputCount ||
    transaction.outputs.length !== outputCount
  ) {
    invalid(`Transition requires exactly ${inputCount} input(s) and ${outputCount} output(s).`);
  }
}

function validateNormalizedTransaction(transaction: KaspaVspcAcceptedTransaction): void {
  normalizeHash(transaction.transactionId, "transaction ID");
  transaction.outputs.forEach((output, index) => {
    if (output.outputIndex !== index)
      invalid("Transaction outputs are not in canonical index order.");
  });
}

function assertFamilyOutput(
  output: KaspaVspcOutput,
  outputIndex: number,
  authorizingInput: number,
  family: NormalizedFamily,
  amountSompi: bigint,
  scriptPublicKeyHex: string,
): void {
  assertOutput(output, outputIndex, amountSompi, scriptPublicKeyHex);
  if (
    output.covenant?.authorizingInput !== authorizingInput ||
    output.covenant.covenantIdHex !== family.covenantIdHex
  ) {
    invalid(`Output ${outputIndex} is not bound to the expected covenant family input.`);
  }
}

function assertPlainOutput(output: KaspaVspcOutput): void {
  if (output.covenant !== null)
    invalid(`Terminal output ${output.outputIndex} must not retain covenant control.`);
}

function assertOutput(
  output: KaspaVspcOutput,
  outputIndex: number,
  amountSompi: bigint,
  scriptPublicKeyHex: string,
): void {
  if (
    output.outputIndex !== outputIndex ||
    output.amountSompi !== amountSompi ||
    output.scriptPublicKeyHex !== scriptPublicKeyHex.toLowerCase()
  ) {
    invalid(`Output ${outputIndex} does not match the covenant-authorized value and script.`);
  }
}

function expectedShardState(shard: GiveawayV6ShardSnapshot): GiveawayV6ShardState {
  return {
    shardIndex: shard.shardIndex,
    count: shard.finalizedEntryCount,
    entriesRootHex: shard.entriesRootHex,
    addressRootHex: shard.addressRootHex,
    pendingHashHex: shard.pendingEntry?.commitmentHex ?? ZERO_HASH_HEX,
  };
}

function assertPendingUtxoDaa(input: KaspaVspcInput, shard: GiveawayV6ShardSnapshot): void {
  if (
    shard.pendingEntry !== null &&
    input.utxo.blockDaaScore !== shard.pendingEntry.registeredAtDaa
  ) {
    invalid(
      `Shard ${shard.shardIndex} input DAA score does not match its pending registration output.`,
    );
  }
}

function assertShardState(actual: GiveawayV6ShardState, expected: GiveawayV6ShardState): void {
  if (
    actual.shardIndex !== expected.shardIndex ||
    actual.count !== expected.count ||
    actual.entriesRootHex !== expected.entriesRootHex ||
    actual.addressRootHex !== expected.addressRootHex ||
    actual.pendingHashHex !== expected.pendingHashHex
  ) {
    invalid(
      `Shard ${expected.shardIndex} witness state does not match its reconstructed chain tip.`,
    );
  }
}

function assertFrozenPrizeState(
  actual: GiveawayV6PrizeState,
  snapshot: GiveawayV6ReconstructionSnapshot,
): void {
  if (snapshot.frozenRootHex === null || snapshot.frozenEntryCount === null) {
    invalid("Terminal transition requires a reconstructed frozen state.");
  }
  assertPrizeState(actual, {
    phase: 2,
    frozenRootHex: snapshot.frozenRootHex,
    entryCount: snapshot.frozenEntryCount,
  });
}

function assertPrizeState(actual: GiveawayV6PrizeState, expected: GiveawayV6PrizeState): void {
  if (
    actual.phase !== expected.phase ||
    actual.frozenRootHex !== expected.frozenRootHex ||
    actual.entryCount !== expected.entryCount
  ) {
    invalid("Prize witness state does not match the expected covenant phase.");
  }
}

function assertTemplate(actual: string, expected: string, label: string): void {
  if (actual !== expected) invalid(`${label} witness uses an unexpected SilverScript template.`);
}

function assertOutpoint(
  actual: GiveawayV6Outpoint,
  expected: GiveawayV6Outpoint | null,
  label: string,
): void {
  if (
    expected === null ||
    actual.transactionId !== expected.transactionId ||
    actual.outputIndex !== expected.outputIndex
  ) {
    invalid(`${label} does not consume the reconstructed family outpoint.`);
  }
}

function outpointsEqual(actual: GiveawayV6Outpoint, expected: GiveawayV6Outpoint): boolean {
  return (
    actual.transactionId === expected.transactionId && actual.outputIndex === expected.outputIndex
  );
}

function normalizeOutpoint(value: GiveawayV6Outpoint, label: string): GiveawayV6Outpoint {
  if (
    !Number.isInteger(value.outputIndex) ||
    value.outputIndex < 0 ||
    value.outputIndex > 0xffffffff
  ) {
    familyError(`${label} has an invalid output index.`);
  }
  return {
    transactionId: normalizeHash(value.transactionId, `${label} transaction ID`),
    outputIndex: value.outputIndex,
  };
}

function normalizeHash(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/u.test(normalized)) familyError(`${label} must be 32-byte hex.`);
  return normalized;
}

function requireHeader(
  headers: ReadonlyMap<string, KaspaVspcHeader>,
  hash: string,
  label: string,
): KaspaVspcHeader {
  const header = headers.get(hash);
  if (header === undefined) {
    throw new GiveawayV6ProjectionError(
      "MISSING_HEADER",
      `Draw ${label} header ${hash} is missing from the confirmed header set.`,
    );
  }
  return header;
}

function checkedSum(...values: readonly bigint[]): bigint {
  const total = values.reduce((sum, value) => sum + value, 0n);
  if (total < 0n || total > MAX_U64) familyError("Covenant amount arithmetic exceeds uint64.");
  return total;
}

function familyError(message: string): never {
  throw new GiveawayV6ProjectionError("INVALID_FAMILY", message);
}

function invalid(message: string): never {
  throw new GiveawayV6ProjectionError("INVALID_TRANSITION", message);
}
