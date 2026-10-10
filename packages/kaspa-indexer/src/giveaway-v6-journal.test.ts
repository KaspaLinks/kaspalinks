import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { GiveawayV6ReconstructionConfig } from "./giveaway-v6-reconstructor";
import type { GiveawayV6FamilyDescriptor } from "./giveaway-v6-projector";
import {
  advanceGiveawayV6Projection,
  parseGiveawayV6ProjectionCheckpoint,
  serializeGiveawayV6ProjectionCheckpoint,
  type GiveawayV6ProjectionCheckpoint,
} from "./giveaway-v6-journal";
import type {
  KaspaVspcAcceptedTransaction,
  KaspaVspcHeader,
  KaspaVspcV2Page,
} from "./kaspa-vspc-v2";

type AbiVectors = {
  prize: {
    redeemScriptHex: string;
    callPrefixHex: Record<string, string>;
  };
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

const ANCHOR = "01".repeat(32);
const OLD_CURSOR = "02".repeat(32);
const ACTIVATION_BLOCK = "03".repeat(32);
const NEW_CURSOR = "04".repeat(32);
const COVENANT_ID = "aa".repeat(32);
const ACTIVATION_TX = "10".repeat(32);

const config: GiveawayV6ReconstructionConfig = {
  giveawayIdHex: "42".repeat(32),
  closesAtDaa: 100n,
  returnAtDaa: 200n,
  entropyTargetBlueScore: 150n,
  shardCount: 1,
  treeDepth: 4,
  maxEntriesPerShard: 16,
  returnScriptPublicKeyHex: "000051",
};

const family: GiveawayV6FamilyDescriptor = {
  genesisOutpoint: { transactionId: "09".repeat(32), outputIndex: 0 },
  covenantIdHex: COVENANT_ID,
  prizeTemplateHashHex: "11".repeat(32),
  shardTemplateHashHex: "12".repeat(32),
  prizeValueSompi: 1_000n,
  shardValueSompi: 2_000n,
  entryFeeSompi: 50n,
  activationFeeSompi: 100n,
  freezeFeeSompi: 100n,
  drawFeeSompi: 100n,
  returnFeeSompi: 100n,
};

function checkpoint(): GiveawayV6ProjectionCheckpoint {
  return {
    schemaVersion: 1,
    network: "mainnet",
    anchorHash: ANCHOR,
    cursorHash: OLD_CURSOR,
    covenantIdHex: COVENANT_ID,
    lastPageFingerprint: "99".repeat(32),
    transitions: [
      {
        acceptingBlockHash: ACTIVATION_BLOCK,
        event: {
          kind: "activate",
          transactionId: ACTIVATION_TX,
          blockDaaScore: 90n,
          prizeOutputIndex: 0,
          shardOutputIndexes: [1],
        },
      },
    ],
  };
}

describe("Giveaway V6 projection journal", () => {
  it("rolls back events from removed selected-chain blocks and is idempotent", () => {
    const reorgPage = page({
      removed: [ACTIVATION_BLOCK, OLD_CURSOR],
      added: [NEW_CURSOR],
      blocks: [{ header: header(NEW_CURSOR, ANCHOR), acceptedTransactions: [] }],
    });
    const first = advanceGiveawayV6Projection({
      checkpoint: checkpoint(),
      startHash: OLD_CURSOR,
      page: reorgPage,
      config,
      family,
    });
    expect(first).toMatchObject({
      status: "applied",
      checkpoint: { cursorHash: NEW_CURSOR, transitions: [] },
      projection: { snapshot: { phase: "awaiting_activation" } },
    });
    if (first.status !== "applied") throw new Error("expected applied page");

    const repeated = advanceGiveawayV6Projection({
      checkpoint: first.checkpoint,
      startHash: OLD_CURSOR,
      page: reorgPage,
      config,
      family,
    });
    expect(repeated).toEqual(first);
  });

  it("round-trips a strict JSON-safe restart checkpoint", () => {
    const serialized = serializeGiveawayV6ProjectionCheckpoint(checkpoint());
    expect(serialized.transitions[0]!.event).toMatchObject({ blockDaaScore: "90" });
    expect(parseGiveawayV6ProjectionCheckpoint(serialized)).toEqual(checkpoint());

    expect(() =>
      parseGiveawayV6ProjectionCheckpoint({
        ...serialized,
        transitions: [
          {
            ...serialized.transitions[0],
            event: { ...(serialized.transitions[0]!.event as object), blockDaaScore: 90 },
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }));
    expect(() =>
      parseGiveawayV6ProjectionCheckpoint({ ...serialized, privateKey: "never" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CHECKPOINT" }));
  });

  it("pauses before a draw until both referenced confirmed headers are supplied", () => {
    const drawTx = drawTransaction();
    const drawBlock = "55".repeat(32);
    const result = advanceGiveawayV6Projection({
      checkpoint: null,
      startHash: ANCHOR,
      page: page({
        removed: [],
        added: [drawBlock],
        blocks: [{ header: header(drawBlock, ANCHOR), acceptedTransactions: [drawTx] }],
      }),
      config,
      family,
    });

    expect(result).toEqual({
      status: "needs_headers",
      requiredHeaderHashes: ["45".repeat(32), "46".repeat(32)],
    });
  });
});

function page(input: {
  removed: string[];
  added: string[];
  blocks: KaspaVspcV2Page["blocks"];
}): KaspaVspcV2Page {
  return {
    network: "mainnet",
    removedChainBlockHashes: input.removed,
    addedChainBlockHashes: input.added,
    blocks: input.blocks,
  };
}

function header(hash: string, parent: string): KaspaVspcHeader {
  return {
    hash,
    directParentHashes: [parent],
    selectedParentHash: parent,
    acceptedIdMerkleRoot: "77".repeat(32),
    daaScore: 1n,
    blueScore: 1n,
  };
}

function drawTransaction(): KaspaVspcAcceptedTransaction {
  const signatureScriptHex =
    fixture.prize.callPrefixHex.draw! + pushData(fixture.prize.redeemScriptHex);
  return {
    transactionId: "66".repeat(32),
    version: 1,
    acceptingBlockHash: "55".repeat(32),
    acceptingDaaScore: 500_000_001n,
    inputs: [
      {
        previousOutpoint: { transactionId: "65".repeat(32), outputIndex: 0 },
        signatureScriptHex,
        sequence: 0n,
        computeBudget: 1,
        utxo: {
          amountSompi: 1_000n,
          scriptPublicKeyHex: "000051",
          blockDaaScore: 500_000_000n,
          covenantIdHex: COVENANT_ID,
          isCoinbase: false,
        },
      },
    ],
    outputs: [{ outputIndex: 0, amountSompi: 1n, scriptPublicKeyHex: "000051", covenant: null }],
  };
}

function pushData(hex: string): string {
  const length = hex.length / 2;
  if (length <= 75) return length.toString(16).padStart(2, "0") + hex;
  if (length <= 0xff) return `4c${length.toString(16).padStart(2, "0")}${hex}`;
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(length);
  return `4d${bytes.toString("hex")}${hex}`;
}
