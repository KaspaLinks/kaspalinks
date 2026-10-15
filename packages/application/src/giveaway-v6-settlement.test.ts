import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  reconstructGiveawayV6,
  type GiveawayV6ChainEvent,
  type GiveawayV6FamilyDescriptor,
  type GiveawayV6ReconstructionConfig,
} from "@kaspa-actions/kaspa-indexer";

import {
  buildGiveawayV6DrawTransaction,
  buildGiveawayV6FreezeTransaction,
  buildGiveawayV6ReturnTransaction,
} from "./giveaway-v6-settlement";

type AbiFixture = {
  prize: { redeemScriptHex: string };
  shard: { redeemScriptHex: string };
};

type ParticipantFixture = { shards: string[][] };

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "labs/claimable-script/fixtures/giveaway_v6_abi_vectors.json"),
    "utf8",
  ),
) as AbiFixture;
const participants = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), "labs/claimable-script/fixtures/giveaway_v6_participants.json"),
    "utf8",
  ),
) as ParticipantFixture;

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
  genesisOutpoint: { transactionId: "10".repeat(32), outputIndex: 0 },
  covenantIdHex: "22".repeat(32),
  prizeTemplateHashHex: "33".repeat(32),
  shardTemplateHashHex: "44".repeat(32),
  prizeValueSompi: 100_000_000n,
  shardValueSompi: 101_000_000n,
  entryFeeSompi: 10_000_000n,
  activationFeeSompi: 10_000_000n,
  freezeFeeSompi: 33_000_000n,
  drawFeeSompi: 18_000_000n,
  returnFeeSompi: 3_000_000n,
};

const activate: GiveawayV6ChainEvent = {
  kind: "activate",
  transactionId: "11".repeat(32),
  blockDaaScore: 499_000_000n,
  prizeOutputIndex: 0,
  shardOutputIndexes: [1, 2, 3, 4],
};

const scripts = {
  prizeRedeemScriptHex: fixture.prize.redeemScriptHex,
  shardTemplateRedeemScriptHex: fixture.shard.redeemScriptHex,
};

describe("Giveaway V6 settlement transactions", () => {
  it("freezes every family tip and returns an empty Giveaway at close", () => {
    const events = [activate];
    const snapshot = reconstructGiveawayV6(config, events);
    const freeze = buildGiveawayV6FreezeTransaction({
      activationBlockDaaScore: activate.blockDaaScore,
      config,
      events,
      family,
      scripts,
      snapshot,
    });

    expect(freeze).toMatchObject({
      entryCount: 0,
      frozenAmountSompi: "471000000",
      minimumFeeSompi: "32178400",
    });
    expect(freeze.inputs).toHaveLength(5);
    expect(JSON.parse(freeze.transactionSafeJson)).toMatchObject({
      lockTime: "500000000",
      outputs: [{ value: "471000000" }],
    });

    const frozen = reconstructGiveawayV6(config, [
      ...events,
      freezeEvent(freeze.transactionId, freeze.frozenRootHex, freeze.entryCount, snapshot),
    ]);
    const returned = buildGiveawayV6ReturnTransaction({
      config,
      family,
      freezeBlockDaaScore: 500_000_010n,
      scripts,
      snapshot: frozen,
    });
    expect(returned.returnAmountSompi).toBe("468000000");
    expect(BigInt(returned.minimumFeeSompi)).toBeLessThanOrEqual(family.returnFeeSompi);
    expect(JSON.parse(returned.transactionSafeJson)).toMatchObject({
      lockTime: "500000000",
      outputs: [{ covenant: null, scriptPublicKey: "000051", value: "468000000" }],
    });
  });

  it("binds a non-empty draw to the chain-selected winner and committed return script", () => {
    const payoutScriptPublicKeyHex = participants.shards[0]![0]!;
    const register: GiveawayV6ChainEvent = {
      kind: "register",
      transactionId: "12".repeat(32),
      blockDaaScore: 499_999_900n,
      shardIndex: 0,
      consumedOutpoint: { transactionId: activate.transactionId, outputIndex: 1 },
      producedOutputIndex: 0,
      payoutScriptPublicKeyHex,
    };
    const events = [activate, register];
    const open = reconstructGiveawayV6(config, events);
    const freeze = buildGiveawayV6FreezeTransaction({
      activationBlockDaaScore: activate.blockDaaScore,
      config,
      events,
      family,
      scripts,
      snapshot: open,
    });
    const frozen = reconstructGiveawayV6(config, [
      ...events,
      freezeEvent(freeze.transactionId, freeze.frozenRootHex, freeze.entryCount, open),
    ]);
    const draw = buildGiveawayV6DrawTransaction({
      compactProofHex: "44",
      config,
      entropy: {
        parentBlockHashHex: "55".repeat(32),
        parentBlueScore: 500_000_099n,
        parentSequenceCommitmentHex: "66".repeat(32),
        candidateBlockHashHex: "77".repeat(32),
        candidateBlueScore: 500_000_100n,
        candidateSequenceCommitmentHex: "88".repeat(32),
      },
      family,
      freezeBlockDaaScore: 500_000_010n,
      scripts,
      snapshot: frozen,
    });

    expect(draw).toMatchObject({
      returnAmountSompi: "343000000",
      winnerGlobalIndex: 0,
      winnerScriptPublicKeyHex: payoutScriptPublicKeyHex,
    });
    expect(BigInt(draw.minimumFeeSompi)).toBeLessThanOrEqual(family.drawFeeSompi);
    expect(JSON.parse(draw.transactionSafeJson).outputs).toEqual([
      {
        covenant: null,
        scriptPublicKey: payoutScriptPublicKeyHex,
        value: "100000000",
      },
      { covenant: null, scriptPublicKey: "000051", value: "343000000" },
    ]);
  });
});

function freezeEvent(
  transactionId: string,
  frozenRootHex: string,
  observedEntryCount: number,
  snapshot: ReturnType<typeof reconstructGiveawayV6>,
): GiveawayV6ChainEvent {
  return {
    kind: "freeze",
    transactionId,
    blockDaaScore: 500_000_010n,
    prizeInputOutpoint: snapshot.prizeOutpoint!,
    shardInputOutpoints: snapshot.shards.map((shard) => shard.tipOutpoint!),
    frozenOutputIndex: 0,
    observedFrozenRootHex: frozenRootHex,
    observedEntryCount,
  };
}
