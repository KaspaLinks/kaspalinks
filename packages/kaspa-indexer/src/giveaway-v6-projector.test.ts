import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type {
  GiveawayV6ChainEvent,
  GiveawayV6ReconstructionConfig,
  GiveawayV6ShardSnapshot,
} from "./giveaway-v6-reconstructor";
import { previewGiveawayV6Freeze, reconstructGiveawayV6 } from "./giveaway-v6-reconstructor";
import {
  GiveawayV6ProjectionError,
  projectGiveawayV6Chain,
  type GiveawayV6FamilyDescriptor,
} from "./giveaway-v6-projector";
import {
  buildGiveawayV6InitialShardRedeemScriptHex,
  buildGiveawayV6PrizeRedeemScriptHex,
  buildGiveawayV6ShardRedeemScriptHex,
  giveawayV6PayToScriptHashScriptPublicKeyHex,
} from "./giveaway-v6-witness";
import type {
  KaspaVspcAcceptedTransaction,
  KaspaVspcHeader,
  KaspaVspcInput,
  KaspaVspcOutput,
} from "./kaspa-vspc-v2";

type AbiVectorContract = {
  templateHashHex: string;
  redeemScriptHex: string;
  dispatchTags: Record<string, string>;
};

type AbiVectors = {
  shard: AbiVectorContract;
  prize: AbiVectorContract;
};

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../labs/claimable-script/fixtures/giveaway_v6_abi_vectors.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as AbiVectors;
const participantFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../labs/claimable-script/fixtures/giveaway_v6_participants.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { shards: string[][] };

const ZERO = "00".repeat(32);
const COVENANT_ID = "aa".repeat(32);
const GENESIS_TX = "01".repeat(32);
const ACTIVATE_TX = "10".repeat(32);
const REGISTER_TX = "11".repeat(32);
const FREEZE_TX = "12".repeat(32);
const TERMINAL_TX = "13".repeat(32);
const PARENT_HASH = "21".repeat(32);
const CANDIDATE_HASH = "22".repeat(32);
const PARENT_SEQUENCE = "31".repeat(32);
const CANDIDATE_SEQUENCE = "32".repeat(32);
const RETURN_SPK = "000051";
const WINNER_SPK = participantFixture.shards[0]![0]!;

const config: GiveawayV6ReconstructionConfig = {
  giveawayIdHex: "42".repeat(32),
  closesAtDaa: 500_000_000n,
  returnAtDaa: 500_100_000n,
  entropyTargetBlueScore: 500_000_100n,
  shardCount: 4,
  treeDepth: 10,
  maxEntriesPerShard: 1_000,
  returnScriptPublicKeyHex: RETURN_SPK,
};

const family: GiveawayV6FamilyDescriptor = {
  genesisOutpoint: { transactionId: GENESIS_TX, outputIndex: 0 },
  covenantIdHex: COVENANT_ID,
  prizeTemplateHashHex: fixture.prize.templateHashHex,
  shardTemplateHashHex: fixture.shard.templateHashHex,
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 10_000_000n,
  entryFeeSompi: 100_000n,
  activationFeeSompi: 100_000n,
  freezeFeeSompi: 100_000n,
  drawFeeSompi: 100_000n,
  returnFeeSompi: 100_000n,
};

describe("projectGiveawayV6Chain", () => {
  it("reconstructs activation, on-chain registration, freeze, and deterministic draw", () => {
    const scenario = buildScenario("draw");
    const result = projectGiveawayV6Chain({
      config,
      family,
      transactions: [unrelatedTransaction(), ...scenario.transactions],
      headers: scenario.headers,
    });

    expect(result.ignoredTransactionCount).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual([
      "activate",
      "register",
      "freeze",
      "draw",
    ]);
    expect(result.snapshot).toMatchObject({
      phase: "drawn",
      observedRegistrationCount: 1,
      frozenEntryCount: 1,
      terminalTransactionId: TERMINAL_TX,
      winner: {
        globalIndex: 0,
        shardIndex: 0,
        localIndex: 0,
        payoutScriptPublicKeyHex: WINNER_SPK,
      },
    });
  });

  it("continues from a previously verified worker checkpoint", () => {
    const scenario = buildScenario("draw");
    const first = projectGiveawayV6Chain({
      config,
      family,
      transactions: [scenario.transactions[0]!],
      headers: [],
    });
    const resumed = projectGiveawayV6Chain({
      config,
      family,
      initialEvents: first.events,
      transactions: scenario.transactions.slice(1),
      headers: scenario.headers,
    });

    expect(resumed.snapshot).toMatchObject({
      phase: "drawn",
      observedRegistrationCount: 1,
      terminalTransactionId: TERMINAL_TX,
    });
    expect(resumed.events.map((event) => event.kind)).toEqual([
      "activate",
      "register",
      "freeze",
      "draw",
    ]);
  });

  it("allows an empty frozen family to return at close", () => {
    const scenario = buildScenario("empty-return");
    const result = projectGiveawayV6Chain({
      config,
      family,
      transactions: scenario.transactions,
      headers: [],
    });

    expect(result.events.map((event) => event.kind)).toEqual(["activate", "freeze", "return"]);
    expect(result.snapshot).toMatchObject({
      phase: "returned",
      observedRegistrationCount: 0,
      frozenEntryCount: 0,
      terminalTransactionId: TERMINAL_TX,
    });
  });

  it("rejects a database-plausible registration whose on-chain state output was changed", () => {
    const scenario = buildScenario("draw");
    const registration = scenario.transactions[1]!;
    const tampered = {
      ...registration,
      outputs: registration.outputs.map((output) => ({
        ...output,
        scriptPublicKeyHex: `${output.scriptPublicKeyHex.slice(0, -2)}00`,
      })),
    };

    expect(() =>
      projectGiveawayV6Chain({
        config,
        family,
        transactions: [scenario.transactions[0]!, tampered],
        headers: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<GiveawayV6ProjectionError>>({
        code: "INVALID_TRANSITION",
      }),
    );
  });
});

function buildScenario(terminal: "draw" | "empty-return"): {
  transactions: KaspaVspcAcceptedTransaction[];
  headers: KaspaVspcHeader[];
} {
  const bootstrapPrizeRedeem = fixture.prize.redeemScriptHex;
  const shardPrefix = fixture.shard.redeemScriptHex.slice(0, 2);
  const shardSuffix = fixture.shard.redeemScriptHex.slice(2 + 117 * 2);
  const activationEvent: GiveawayV6ChainEvent = {
    kind: "activate",
    transactionId: ACTIVATE_TX,
    blockDaaScore: 499_000_000n,
    prizeOutputIndex: 0,
    shardOutputIndexes: [1, 2, 3, 4],
  };
  const activationSnapshot = reconstructGiveawayV6(config, [activationEvent]);
  const openPrizeRedeem = buildGiveawayV6PrizeRedeemScriptHex(bootstrapPrizeRedeem, {
    phase: 1,
    frozenRootHex: ZERO,
    entryCount: 0,
  });
  const initialShardRedeems = activationSnapshot.shards.map((shard) =>
    buildGiveawayV6InitialShardRedeemScriptHex(shardPrefix, shardState(shard), shardSuffix),
  );
  const activate = transaction({
    id: ACTIVATE_TX,
    daa: 499_000_000n,
    inputs: [
      txInput(
        { transactionId: GENESIS_TX, outputIndex: 0 },
        140_100_000n,
        bootstrapPrizeRedeem,
        witness(
          [shardPrefix, shardSuffix],
          fixture.prize.dispatchTags.activate!,
          bootstrapPrizeRedeem,
        ),
      ),
    ],
    outputs: [
      familyOutput(100_000_000n, openPrizeRedeem, 0),
      ...initialShardRedeems.map((redeem) => familyOutput(10_000_000n, redeem, 0)),
    ],
  });

  const events: GiveawayV6ChainEvent[] = [activationEvent];
  const transactions = [activate];
  let openSnapshot = activationSnapshot;
  let shardRedeems = initialShardRedeems;

  if (terminal === "draw") {
    const registrationEvent: GiveawayV6ChainEvent = {
      kind: "register",
      transactionId: REGISTER_TX,
      blockDaaScore: 499_999_900n,
      shardIndex: 0,
      consumedOutpoint: { transactionId: ACTIVATE_TX, outputIndex: 1 },
      producedOutputIndex: 0,
      payoutScriptPublicKeyHex: WINNER_SPK,
    };
    openSnapshot = reconstructGiveawayV6(config, [...events, registrationEvent]);
    events.push(registrationEvent);
    const registeredShardRedeem = buildGiveawayV6ShardRedeemScriptHex(
      initialShardRedeems[0]!,
      shardState(openSnapshot.shards[0]!),
    );
    transactions.push(
      transaction({
        id: REGISTER_TX,
        daa: 499_999_900n,
        inputs: [
          txInput(
            { transactionId: ACTIVATE_TX, outputIndex: 1 },
            10_000_000n,
            initialShardRedeems[0]!,
            witness(
              [WINNER_SPK, ZERO.repeat(10), ZERO.repeat(256)],
              fixture.shard.dispatchTags.register!,
              initialShardRedeems[0]!,
            ),
            499_000_000n,
          ),
        ],
        outputs: [familyOutput(9_900_000n, registeredShardRedeem, 0)],
      }),
    );
    shardRedeems = [registeredShardRedeem, ...initialShardRedeems.slice(1)];
  }

  const preview = previewGiveawayV6Freeze(config, events);
  const freezeEvent: GiveawayV6ChainEvent = {
    kind: "freeze",
    transactionId: FREEZE_TX,
    blockDaaScore: 500_000_010n,
    prizeInputOutpoint: { transactionId: ACTIVATE_TX, outputIndex: 0 },
    shardInputOutpoints: openSnapshot.shards.map((shard) => shard.tipOutpoint!),
    frozenOutputIndex: 0,
    observedFrozenRootHex: preview.frozenRootHex,
    observedEntryCount: preview.entryCount,
  };
  const frozenSnapshot = reconstructGiveawayV6(config, [...events, freezeEvent]);
  events.push(freezeEvent);
  const frozenPrizeRedeem = buildGiveawayV6PrizeRedeemScriptHex(openPrizeRedeem, {
    phase: 2,
    frozenRootHex: preview.frozenRootHex,
    entryCount: preview.entryCount,
  });
  const frozenValue = terminal === "draw" ? 139_800_000n : 139_900_000n;
  transactions.push(
    transaction({
      id: FREEZE_TX,
      daa: 500_000_010n,
      inputs: [
        txInput(
          { transactionId: ACTIVATE_TX, outputIndex: 0 },
          100_000_000n,
          openPrizeRedeem,
          witness(
            [ZERO.repeat(config.shardCount * config.treeDepth)],
            fixture.prize.dispatchTags.freeze!,
            openPrizeRedeem,
          ),
          499_000_000n,
        ),
        ...shardRedeems.map((redeem, index) =>
          txInput(
            openSnapshot.shards[index]!.tipOutpoint!,
            index === 0 && terminal === "draw" ? 9_900_000n : 10_000_000n,
            redeem,
            witness([], fixture.shard.dispatchTags.delegateFreeze!, redeem),
            index === 0 && terminal === "draw" ? 499_999_900n : 499_000_000n,
          ),
        ),
      ],
      outputs: [familyOutput(frozenValue, frozenPrizeRedeem, 0)],
    }),
  );

  if (terminal === "empty-return") {
    transactions.push(
      transaction({
        id: TERMINAL_TX,
        daa: 500_000_011n,
        inputs: [
          txInput(
            { transactionId: FREEZE_TX, outputIndex: 0 },
            frozenValue,
            frozenPrizeRedeem,
            witness([], fixture.prize.dispatchTags.returnFunds!, frozenPrizeRedeem),
            500_000_010n,
          ),
        ],
        outputs: [plainOutput(frozenValue - 100_000n, RETURN_SPK)],
      }),
    );
    return { transactions, headers: [] };
  }

  const drawWitness = witness(
    [
      "44",
      PARENT_HASH,
      scriptInt(500_000_099n),
      CANDIDATE_HASH,
      scriptInt(500_000_100n),
      frozenSnapshot.shards.map((shard) => u64Le(BigInt(shard.finalizedEntryCount))).join(""),
      frozenSnapshot.shards.map((shard) => shard.entriesRootHex).join(""),
      frozenSnapshot.shards.map((shard) => shard.addressRootHex).join(""),
      WINNER_SPK,
      ZERO.repeat(config.treeDepth),
    ],
    fixture.prize.dispatchTags.draw!,
    frozenPrizeRedeem,
  );
  transactions.push(
    transaction({
      id: TERMINAL_TX,
      daa: 500_000_020n,
      inputs: [
        txInput(
          { transactionId: FREEZE_TX, outputIndex: 0 },
          frozenValue,
          frozenPrizeRedeem,
          drawWitness,
          500_000_010n,
        ),
      ],
      outputs: [
        plainOutput(100_000_000n, WINNER_SPK),
        plainOutput(frozenValue - 100_100_000n, RETURN_SPK),
      ],
    }),
  );
  return {
    transactions,
    headers: [
      header(PARENT_HASH, "20".repeat(32), 500_000_099n, PARENT_SEQUENCE),
      header(CANDIDATE_HASH, PARENT_HASH, 500_000_100n, CANDIDATE_SEQUENCE),
    ],
  };
}

function shardState(shard: GiveawayV6ShardSnapshot) {
  return {
    shardIndex: shard.shardIndex,
    count: shard.finalizedEntryCount,
    entriesRootHex: shard.entriesRootHex,
    addressRootHex: shard.addressRootHex,
    pendingHashHex: shard.pendingEntry?.commitmentHex ?? ZERO,
  };
}

function transaction(input: {
  id: string;
  daa: bigint;
  inputs: KaspaVspcInput[];
  outputs: Omit<KaspaVspcOutput, "outputIndex">[];
}): KaspaVspcAcceptedTransaction {
  return {
    transactionId: input.id,
    version: 1,
    acceptingBlockHash: input.id,
    acceptingDaaScore: input.daa,
    inputs: input.inputs,
    outputs: input.outputs.map((output, outputIndex) => ({ ...output, outputIndex })),
  };
}

function txInput(
  previousOutpoint: { transactionId: string; outputIndex: number },
  amountSompi: bigint,
  redeemScriptHex: string,
  signatureScriptHex: string,
  blockDaaScore = 498_000_000n,
): KaspaVspcInput {
  return {
    previousOutpoint,
    signatureScriptHex,
    sequence: 0n,
    computeBudget: 1,
    utxo: {
      amountSompi,
      scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(redeemScriptHex),
      blockDaaScore,
      covenantIdHex: COVENANT_ID,
      isCoinbase: false,
    },
  };
}

function familyOutput(
  amountSompi: bigint,
  redeemScriptHex: string,
  authorizingInput: number,
): Omit<KaspaVspcOutput, "outputIndex"> {
  return {
    amountSompi,
    scriptPublicKeyHex: giveawayV6PayToScriptHashScriptPublicKeyHex(redeemScriptHex),
    covenant: { authorizingInput, covenantIdHex: COVENANT_ID },
  };
}

function plainOutput(
  amountSompi: bigint,
  scriptPublicKeyHex: string,
): Omit<KaspaVspcOutput, "outputIndex"> {
  return { amountSompi, scriptPublicKeyHex, covenant: null };
}

function witness(args: string[], tag: string, redeemScriptHex: string): string {
  return [...args, tag, redeemScriptHex].map(pushData).join("");
}

function pushData(hex: string): string {
  const length = hex.length / 2;
  if (length <= 75) return length.toString(16).padStart(2, "0") + hex;
  if (length <= 0xff) return `4c${length.toString(16).padStart(2, "0")}${hex}`;
  if (length <= 0xffff) {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(length);
    return `4d${bytes.toString("hex")}${hex}`;
  }
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(length);
  return `4e${bytes.toString("hex")}${hex}`;
}

function u64Le(value: bigint): string {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes.toString("hex");
}

function scriptInt(value: bigint): string {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0n) {
    bytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  if ((bytes.at(-1) ?? 0) & 0x80) bytes.push(0);
  return Buffer.from(bytes).toString("hex");
}

function header(
  hash: string,
  selectedParentHash: string,
  blueScore: bigint,
  acceptedIdMerkleRoot: string,
): KaspaVspcHeader {
  return {
    hash,
    directParentHashes: [selectedParentHash],
    selectedParentHash,
    acceptedIdMerkleRoot,
    daaScore: blueScore,
    blueScore,
  };
}

function unrelatedTransaction(): KaspaVspcAcceptedTransaction {
  return {
    transactionId: "fe".repeat(32),
    version: 0,
    acceptingBlockHash: "fd".repeat(32),
    acceptingDaaScore: 1n,
    inputs: [
      {
        previousOutpoint: { transactionId: "fc".repeat(32), outputIndex: 0 },
        signatureScriptHex: "",
        sequence: 0n,
        computeBudget: null,
        utxo: {
          amountSompi: 1n,
          scriptPublicKeyHex: "000051",
          blockDaaScore: 0n,
          covenantIdHex: null,
          isCoinbase: false,
        },
      },
    ],
    outputs: [{ outputIndex: 0, amountSompi: 1n, scriptPublicKeyHex: "000051", covenant: null }],
  };
}
