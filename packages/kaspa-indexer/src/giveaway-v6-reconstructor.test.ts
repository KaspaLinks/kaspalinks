import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GiveawayV6ChainEvent,
  GiveawayV6ReconstructionConfig,
  GiveawayV6ReconstructionError,
  GiveawayV6RegistrationEvent,
  reconstructGiveawayV6,
  serializeGiveawayV6Snapshot,
} from "./giveaway-v6-reconstructor";

const EXPECTED_FROZEN_ROOT = "a8780ddf4e63d1779828849df0c56c67703f0a29ebe0df70b233eebb05149f10";
const PARENT_BLOCK_HASH = "49c362907357ef61e3eeb4a0fcf7cae6b7dc05a04b566ec0a1fae917ab4be2d1";
const CANDIDATE_BLOCK_HASH = "6f47bd29ccfd401757a85ff360dc7076c8e4b167ae4b3ccbeec7550028c0e52b";
const PARENT_SEQUENCE_COMMITMENT =
  "3097c05fdb89cefd0b530db227c5238faf316ed075a43ecb0f36ee12f8358f02";
const CANDIDATE_SEQUENCE_COMMITMENT =
  "bf3b8631a0d02e1a85dff2281e5dde75a5922e3d376eef57f2412100d5eb9ea1";
const RETURN_SCRIPT = "000051";

type ParticipantFixture = {
  giveawayId: string;
  treeDepth: number;
  shards: string[][];
};

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../labs/claimable-script/fixtures/giveaway_v6_participants.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as ParticipantFixture;

const baseConfig: GiveawayV6ReconstructionConfig = {
  giveawayIdHex: fixture.giveawayId,
  closesAtDaa: 100n,
  returnAtDaa: 200n,
  entropyTargetBlueScore: 559_181_995n,
  shardCount: 4,
  treeDepth: fixture.treeDepth,
  maxEntriesPerShard: 16,
  returnScriptPublicKeyHex: RETURN_SCRIPT,
};

function txId(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function buildFixtureHistory(includeDraw = true): GiveawayV6ChainEvent[] {
  const activationId = txId(1);
  const events: GiveawayV6ChainEvent[] = [
    {
      kind: "activate",
      transactionId: activationId,
      blockDaaScore: 70n,
      prizeOutputIndex: 0,
      shardOutputIndexes: [1, 2, 3, 4],
    },
  ];
  const tips = [1, 2, 3, 4].map((outputIndex) => ({ transactionId: activationId, outputIndex }));
  let nextTransaction = 2;
  let nextDaa = 80n;
  for (let localIndex = 0; localIndex < 3; localIndex += 1) {
    for (let shardIndex = 0; shardIndex < fixture.shards.length; shardIndex += 1) {
      const transactionId = txId(nextTransaction);
      events.push({
        kind: "register",
        transactionId,
        blockDaaScore: nextDaa,
        shardIndex,
        consumedOutpoint: tips[shardIndex]!,
        producedOutputIndex: 0,
        payoutScriptPublicKeyHex: fixture.shards[shardIndex]![localIndex]!,
      });
      tips[shardIndex] = { transactionId, outputIndex: 0 };
      nextTransaction += 1;
      nextDaa += 1n;
    }
  }
  const freezeId = txId(nextTransaction);
  events.push({
    kind: "freeze",
    transactionId: freezeId,
    blockDaaScore: 100n,
    prizeInputOutpoint: { transactionId: activationId, outputIndex: 0 },
    shardInputOutpoints: tips,
    frozenOutputIndex: 0,
    observedFrozenRootHex: EXPECTED_FROZEN_ROOT,
    observedEntryCount: 12,
  });
  if (includeDraw) {
    events.push({
      kind: "draw",
      transactionId: txId(nextTransaction + 1),
      blockDaaScore: 101n,
      frozenInputOutpoint: { transactionId: freezeId, outputIndex: 0 },
      parentBlockHashHex: PARENT_BLOCK_HASH,
      parentBlueScore: 559_181_983n,
      parentSequenceCommitmentHex: PARENT_SEQUENCE_COMMITMENT,
      candidateBlockHashHex: CANDIDATE_BLOCK_HASH,
      candidateBlueScore: 559_181_995n,
      candidateSequenceCommitmentHex: CANDIDATE_SEQUENCE_COMMITMENT,
      winnerOutputScriptPublicKeyHex: fixture.shards[1]![2]!,
      returnOutputScriptPublicKeyHex: RETURN_SCRIPT,
    });
  }
  return events;
}

describe("reconstructGiveawayV6", () => {
  it("rebuilds the SilverScript fixture root and Mainnet-header winner from chain transitions", () => {
    const result = reconstructGiveawayV6(baseConfig, buildFixtureHistory());

    expect(result.phase).toBe("drawn");
    expect(result.observedRegistrationCount).toBe(12);
    expect(result.frozenEntryCount).toBe(12);
    expect(result.frozenRootHex).toBe(EXPECTED_FROZEN_ROOT);
    expect(result.shards.map((shard) => shard.finalizedEntryCount)).toEqual([3, 3, 3, 3]);
    expect(result.winner).toMatchObject({
      globalIndex: 5,
      shardIndex: 1,
      localIndex: 2,
      payoutScriptPublicKeyHex: fixture.shards[1]![2],
      candidateBlockHashHex: CANDIDATE_BLOCK_HASH,
      candidateSequenceCommitmentHex: CANDIDATE_SEQUENCE_COMMITMENT,
    });
    expect(result.winner?.merkleSiblingsHex).toHaveLength(fixture.treeDepth);

    expect(reconstructGiveawayV6(baseConfig, buildFixtureHistory())).toEqual(result);
  });

  it("rejects duplicate payout commitments and incorrect deterministic shards", () => {
    const activation = buildFixtureHistory(false)[0]!;
    const payoutScriptPublicKeyHex = fixture.shards[0]![0]!;
    const first: GiveawayV6RegistrationEvent = {
      kind: "register",
      transactionId: txId(40),
      blockDaaScore: 80n,
      shardIndex: 0,
      consumedOutpoint: { transactionId: txId(1), outputIndex: 1 },
      producedOutputIndex: 0,
      payoutScriptPublicKeyHex,
    };
    const duplicate: GiveawayV6RegistrationEvent = {
      ...first,
      transactionId: txId(41),
      blockDaaScore: 81n,
      consumedOutpoint: { transactionId: txId(40), outputIndex: 0 },
    };

    expectCode(
      () => reconstructGiveawayV6(baseConfig, [activation, first, duplicate]),
      "DUPLICATE_ENTRY",
    );
    expectCode(
      () => reconstructGiveawayV6(baseConfig, [activation, { ...first, shardIndex: 1 }]),
      "INVALID_LINEAGE",
    );
    expectCode(
      () =>
        reconstructGiveawayV6(baseConfig, [
          activation,
          {
            ...first,
            shardIndex: 1,
            consumedOutpoint: { transactionId: txId(1), outputIndex: 2 },
          },
        ]),
      "WRONG_SHARD",
    );
  });

  it("rejects a frozen output that disagrees with the reconstructed participant set", () => {
    const events = buildFixtureHistory(false);
    const freeze = events.at(-1)!;
    if (freeze.kind !== "freeze") throw new Error("expected freeze fixture");
    events[events.length - 1] = { ...freeze, observedEntryCount: 11 };

    expectCode(() => reconstructGiveawayV6(baseConfig, events), "FROZEN_STATE_MISMATCH");
  });

  it("excludes a late pending entry and permits the exact keyless return at close", () => {
    const config = { ...baseConfig, shardCount: 1 };
    const activationId = txId(50);
    const registrationId = txId(51);
    const activation: GiveawayV6ChainEvent = {
      kind: "activate",
      transactionId: activationId,
      blockDaaScore: 90n,
      prizeOutputIndex: 0,
      shardOutputIndexes: [1],
    };
    const registration: GiveawayV6ChainEvent = {
      kind: "register",
      transactionId: registrationId,
      blockDaaScore: 101n,
      shardIndex: 0,
      consumedOutpoint: { transactionId: activationId, outputIndex: 1 },
      producedOutputIndex: 0,
      payoutScriptPublicKeyHex: fixture.shards[0]![0]!,
    };
    const open = reconstructGiveawayV6(config, [activation, registration]);
    const shard = open.shards[0]!;
    const frozenRoot = aggregateSingleEmptyShard(shard.entriesRootHex, shard.addressRootHex);
    const freezeId = txId(52);
    const freeze: GiveawayV6ChainEvent = {
      kind: "freeze",
      transactionId: freezeId,
      blockDaaScore: 102n,
      prizeInputOutpoint: { transactionId: activationId, outputIndex: 0 },
      shardInputOutpoints: [{ transactionId: registrationId, outputIndex: 0 }],
      frozenOutputIndex: 0,
      observedFrozenRootHex: frozenRoot,
      observedEntryCount: 0,
    };
    const returned = reconstructGiveawayV6(config, [
      activation,
      registration,
      freeze,
      {
        kind: "return",
        transactionId: txId(53),
        blockDaaScore: 102n,
        frozenInputOutpoint: { transactionId: freezeId, outputIndex: 0 },
        returnOutputScriptPublicKeyHex: RETURN_SCRIPT,
      },
    ]);

    expect(returned.phase).toBe("returned");
    expect(returned.observedRegistrationCount).toBe(1);
    expect(returned.frozenEntryCount).toBe(0);
    expect(returned.shards[0]?.excludedLateEntry?.registrationTransactionId).toBe(registrationId);
    expect(returned.shards[0]?.addressRootHex).toBe(shard.addressRootHex);
    expect(
      serializeGiveawayV6Snapshot(returned).shards[0]?.excludedLateEntry?.registeredAtDaa,
    ).toBe("101");
  });

  it("rejects a redirected winner payout and an invalid entropy boundary", () => {
    const events = buildFixtureHistory();
    const draw = events.at(-1)!;
    if (draw.kind !== "draw") throw new Error("expected draw fixture");
    events[events.length - 1] = { ...draw, winnerOutputScriptPublicKeyHex: fixture.shards[0]![0]! };
    expectCode(() => reconstructGiveawayV6(baseConfig, events), "WINNER_MISMATCH");

    events[events.length - 1] = { ...draw, parentBlueScore: draw.candidateBlueScore };
    expectCode(() => reconstructGiveawayV6(baseConfig, events), "INVALID_EVENT");
  });
});

function aggregateSingleEmptyShard(entriesRootHex: string, addressRootHex: string): string {
  const initial = createHash("sha256").update(new Uint8Array()).digest();
  const index = Buffer.alloc(8);
  const count = Buffer.alloc(8);
  return createHash("sha256")
    .update(initial)
    .update(index)
    .update(count)
    .update(Buffer.from(entriesRootHex, "hex"))
    .update(Buffer.from(addressRootHex, "hex"))
    .digest("hex");
}

function expectCode(action: () => unknown, code: GiveawayV6ReconstructionError["code"]): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(GiveawayV6ReconstructionError);
    expect(error).toMatchObject({ code });
  }
}
