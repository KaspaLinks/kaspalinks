import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  GIVEAWAY_V6_COMPILER_COMMIT,
  GIVEAWAY_V6_PRIZE_SOURCE_SHA256,
  GIVEAWAY_V6_SHARD_SOURCE_SHA256,
  decodeGiveawayV6Witness,
} from "./giveaway-v6-witness";

type AbiVectorContract = {
  sourceSha256: string;
  stateSpan: { offset: number; len: number };
  templateHashHex: string;
  redeemScriptHex: string;
  dispatchTags: Record<string, string>;
  callPrefixHex: Record<string, string>;
};

type AbiVectors = {
  schemaVersion: number;
  compilerVersion: string;
  compilerCommit: string;
  shard: AbiVectorContract;
  prize: AbiVectorContract;
};

const fixturePath = new URL(
  "../../../labs/claimable-script/fixtures/giveaway_v6_abi_vectors.json",
  import.meta.url,
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as AbiVectors;

describe("decodeGiveawayV6Witness", () => {
  it("decodes the compiler-generated shard registration and runtime state", () => {
    const decoded = decodeVector(fixture.shard, "register");

    expect(decoded).toMatchObject({
      contract: "shard",
      method: "register",
      templateHashHex: fixture.shard.templateHashHex,
      state: {
        shardIndex: 0,
        count: 0,
        entriesRootHex: "fd5c382285c04ecafde1873bd07c0f09dacb4cb96b528826de6c8b8a603cdb1b",
        addressRootHex: "80176086d6573143a707cd9b78405ab1f7db57e8d43e3102de749bb1680725a2",
        pendingHashHex: "00".repeat(32),
      },
      payoutScriptPublicKeyHex: "ab".repeat(36),
      appendSiblingCount: 10,
      addressSiblingCount: 256,
    });
  });

  it("decodes the compiler-generated delegate, activation, freeze, and return entries", () => {
    expect(decodeVector(fixture.shard, "delegateFreeze")).toMatchObject({
      contract: "shard",
      method: "delegateFreeze",
      templateHashHex: fixture.shard.templateHashHex,
    });
    expect(decodeVector(fixture.prize, "activate")).toMatchObject({
      contract: "prize",
      method: "activate",
      templateHashHex: fixture.prize.templateHashHex,
      state: { phase: 0, frozenRootHex: "00".repeat(32), entryCount: 0 },
      shardPrefixHex: "31".repeat(5),
      shardSuffixHex: "32".repeat(6),
    });
    expect(decodeVector(fixture.prize, "freeze")).toMatchObject({
      contract: "prize",
      method: "freeze",
      pendingSiblingCount: 40,
    });
    expect(decodeVector(fixture.prize, "returnFunds")).toMatchObject({
      contract: "prize",
      method: "returnFunds",
    });
  });

  it("decodes the proof-bound draw without retaining the proof bytes", () => {
    const decoded = decodeVector(fixture.prize, "draw");

    expect(decoded).toMatchObject({
      contract: "prize",
      method: "draw",
      parentBlockHashHex: "45".repeat(32),
      parentBlueScore: 499_999_999n,
      candidateBlockHashHex: "46".repeat(32),
      candidateBlueScore: 500_000_000n,
      shardCounts: [1, 2, 3, 4],
      shardEntriesRootsHex: Array(4).fill("47".repeat(32)),
      shardAddressRootsHex: Array(4).fill("48".repeat(32)),
      winnerScriptPublicKeyHex: "49".repeat(36),
      winnerSiblingCount: 10,
      proofSha256Hex: sha256Hex("44".repeat(16)),
    });
    expect(decoded).not.toHaveProperty("proofHex");
  });

  it("rejects unknown entries, non-canonical pushes, and invalid runtime state", () => {
    const redeemPush = pushData(fixture.prize.redeemScriptHex);
    expect(() => decodeGiveawayV6Witness(`04deadbeef${redeemPush}`)).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_ENTRY" }),
    );
    expect(() =>
      decodeGiveawayV6Witness(`4c04${fixture.prize.dispatchTags.returnFunds}${redeemPush}`),
    ).toThrowError(expect.objectContaining({ code: "INVALID_PUSH" }));

    const tampered = Buffer.from(fixture.prize.redeemScriptHex, "hex");
    tampered[9] = 0x80;
    expect(() =>
      decodeGiveawayV6Witness(
        fixture.prize.callPrefixHex.returnFunds + pushData(tampered.toString("hex")),
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_STATE" }));
  });

  it("pins the ABI vectors to the reviewed compiler and V6 sources", () => {
    const root = new URL("../../../labs/claimable-script/", import.meta.url);
    const shardSource = readFileSync(new URL("giveaway_entry_shard_v6.sil", root));
    const prizeSource = readFileSync(new URL("giveaway_prize_shards_v6.sil", root));

    expect(fixture).toMatchObject({
      schemaVersion: 1,
      compilerVersion: "0.1.0",
      compilerCommit: GIVEAWAY_V6_COMPILER_COMMIT,
      shard: { stateSpan: { offset: 1, len: 117 } },
      prize: { stateSpan: { offset: 1, len: 51 } },
    });
    expect(createHash("sha256").update(shardSource).digest("hex")).toBe(
      GIVEAWAY_V6_SHARD_SOURCE_SHA256,
    );
    expect(createHash("sha256").update(prizeSource).digest("hex")).toBe(
      GIVEAWAY_V6_PRIZE_SOURCE_SHA256,
    );
    expect(fixture.shard.sourceSha256).toBe(GIVEAWAY_V6_SHARD_SOURCE_SHA256);
    expect(fixture.prize.sourceSha256).toBe(GIVEAWAY_V6_PRIZE_SOURCE_SHA256);
  });
});

function decodeVector(contract: AbiVectorContract, method: string) {
  const prefix = contract.callPrefixHex[method];
  if (!prefix) throw new Error(`missing ${method} ABI vector`);
  return decodeGiveawayV6Witness(prefix + pushData(contract.redeemScriptHex));
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

function sha256Hex(hex: string): string {
  return createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
}
