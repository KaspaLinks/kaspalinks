import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  GIVEAWAY_V3_MAX_ENTRIES,
  giveawayV3Digest,
  giveawayV3Draw,
  giveawayV3EntriesAttestationDigest,
  giveawayV3EntriesBlob,
  giveawayV3EntriesRoot,
  giveawayV3EntropyAttestationDigest,
  giveawayV3EntryHash,
  giveawayV3FrozenStateHash,
  giveawayV3OpenStateHash,
  giveawayV3ParamsHash,
  giveawayV3SortEntryHashes,
  giveawayV3WinnerIndex,
} from "./giveaway-prize-v3-proof";

const SEED = "5c".repeat(32);

const PARAMS = giveawayV3ParamsHash({
  prizeSompi: 100_000_000n,
  drawFeeSompi: 3_000n,
  closesAtDaa: 200_000_000n,
  refundDaa: 200_100_000n,
  creatorPublicKeyHex: "22".repeat(32),
});

function spk(index: number): string {
  return `0000${(0x51).toString(16)}${(0x60 + index).toString(16).padStart(2, "0")}`;
}

function entries(count: number): string[] {
  return giveawayV3SortEntryHashes(
    Array.from({ length: count }, (_unused, index) => giveawayV3EntryHash(spk(index))),
  );
}

describe("giveaway v3 proof", () => {
  it("commits an entrant by their script public key, not their address", () => {
    const expected = createHash("sha256")
      .update(Buffer.from(spk(0), "hex"))
      .digest("hex");
    expect(giveawayV3EntryHash(spk(0))).toBe(expected);
  });

  it("orders entries canonically regardless of arrival order", () => {
    const forward = entries(6);
    const shuffled = giveawayV3SortEntryHashes([...forward].reverse());
    expect(shuffled).toEqual(forward);
  });

  it("builds the flat blob the draw witness carries", () => {
    const list = entries(5);
    const blob = giveawayV3EntriesBlob(list);
    expect(blob).toHaveLength(5 * 32);
    expect(blob.subarray(64, 96).toString("hex")).toBe(list[2]);
  });

  it("roots the entry list as a single hash over the blob", () => {
    const list = entries(4);
    const expected = createHash("sha256").update(giveawayV3EntriesBlob(list)).digest("hex");
    expect(giveawayV3EntriesRoot(list)).toBe(expected);
  });

  it("changes the root when a single entry changes", () => {
    const list = entries(4);
    const tampered = [...list];
    tampered[1] = giveawayV3EntryHash(spk(99));
    expect(giveawayV3EntriesRoot(giveawayV3SortEntryHashes(tampered))).not.toBe(
      giveawayV3EntriesRoot(list),
    );
  });

  it("derives the winner index as unsigned little-endian, matching the script", () => {
    const list = entries(4);
    const digest = giveawayV3Digest({ seedHex: SEED, entriesRootHex: giveawayV3EntriesRoot(list) });
    const expected = Buffer.from(digest, "hex").readUInt32LE(0) % list.length;
    expect(giveawayV3WinnerIndex(digest, list.length)).toBe(expected);
  });

  it("never derives an index outside the entry list", () => {
    for (let count = 1; count <= 40; count += 1) {
      const list = entries(count);
      const draw = giveawayV3Draw({ seedHex: SEED, sortedEntryHashes: list });
      expect(draw.winnerIndex).toBeGreaterThanOrEqual(0);
      expect(draw.winnerIndex).toBeLessThan(count);
      expect(draw.winnerEntryHashHex).toBe(list[draw.winnerIndex]);
    }
  });

  it("picks a different winner when the entropy changes", () => {
    const list = entries(64);
    const a = giveawayV3Draw({ seedHex: SEED, sortedEntryHashes: list });
    const b = giveawayV3Draw({ seedHex: "a7".repeat(32), sortedEntryHashes: list });
    expect(a.digestHex).not.toBe(b.digestHex);
  });

  it("binds both attestations to one giveaway", () => {
    const root = giveawayV3EntriesRoot(entries(3));
    const other = giveawayV3ParamsHash({
      prizeSompi: 100_000_001n,
      drawFeeSompi: 3_000n,
      closesAtDaa: 200_000_000n,
      refundDaa: 200_100_000n,
      creatorPublicKeyHex: "22".repeat(32),
    });
    expect(
      giveawayV3EntriesAttestationDigest({ paramsHashHex: PARAMS, entriesRootHex: root }),
    ).not.toBe(giveawayV3EntriesAttestationDigest({ paramsHashHex: other, entriesRootHex: root }));
    expect(
      giveawayV3EntropyAttestationDigest({ paramsHashHex: PARAMS, blockHashHex: SEED }),
    ).not.toBe(giveawayV3EntropyAttestationDigest({ paramsHashHex: other, blockHashHex: SEED }));
  });

  it("changes the params hash when any single parameter changes", () => {
    const base = {
      prizeSompi: 100_000_000n,
      drawFeeSompi: 3_000n,
      closesAtDaa: 200_000_000n,
      refundDaa: 200_100_000n,
      creatorPublicKeyHex: "22".repeat(32),
    };
    const variants = [
      { ...base, prizeSompi: 100_000_001n },
      { ...base, drawFeeSompi: 3_001n },
      { ...base, closesAtDaa: 200_000_001n },
      { ...base, refundDaa: 200_100_001n },
      { ...base, creatorPublicKeyHex: "23".repeat(32) },
    ].map(giveawayV3ParamsHash);
    expect(new Set([...variants, PARAMS]).size).toBe(6);
  });

  it("separates the open and frozen states", () => {
    const root = giveawayV3EntriesRoot(entries(3));
    expect(giveawayV3OpenStateHash(PARAMS)).not.toBe(giveawayV3FrozenStateHash(PARAMS, root));
  });

  it("keeps the two attestation digests distinct for identical inputs", () => {
    // Ohne getrennte Domain-Tags waere eine Signatur ueber die Teilnehmerliste
    // zugleich eine gueltige Signatur ueber einen Entropie-Block.
    const shared = "33".repeat(32);
    expect(
      giveawayV3EntriesAttestationDigest({ paramsHashHex: PARAMS, entriesRootHex: shared }),
    ).not.toBe(giveawayV3EntropyAttestationDigest({ paramsHashHex: PARAMS, blockHashHex: shared }));
  });

  it("commits the frozen state to both the params and the entry root", () => {
    const root = giveawayV3EntriesRoot(entries(3));
    const expected = createHash("sha256")
      .update(
        Buffer.concat([Buffer.from([0x01]), Buffer.from(PARAMS, "hex"), Buffer.from(root, "hex")]),
      )
      .digest("hex");
    expect(giveawayV3FrozenStateHash(PARAMS, root)).toBe(expected);
  });

  it("rejects malformed input rather than hashing it", () => {
    expect(() => giveawayV3EntryHash("not-hex")).toThrow();
    expect(() => giveawayV3EntriesRoot([])).toThrow();
    expect(() => giveawayV3WinnerIndex("00".repeat(32), 0)).toThrow();
    expect(() =>
      giveawayV3EntriesBlob(new Array(GIVEAWAY_V3_MAX_ENTRIES + 1).fill("00".repeat(32))),
    ).toThrow();
  });
});

describe("fundable V3 parameters", () => {
  const valid = {
    prizeSompi: 100_000_000n,
    drawFeeSompi: 300_000n,
    closesAtDaa: 500_000_000n,
    refundDaa: 500_100_000n,
    creatorPublicKeyHex: "22".repeat(32),
  };
  it.each([
    { prizeSompi: 0n },
    { drawFeeSompi: 0n },
    { closesAtDaa: 0n },
    { refundDaa: 500_000_000n },
    { refundDaa: 499_999_999n },
  ])("rejects unusable contract parameters %s", (change) => {
    expect(() => giveawayV3ParamsHash({ ...valid, ...change })).toThrow();
  });
  it("normalizes the winning entry consistently with the commitment", () => {
    expect(
      giveawayV3Draw({ seedHex: SEED, sortedEntryHashes: ["AB".repeat(32)] }).winnerEntryHashHex,
    ).toBe("ab".repeat(32));
  });
});
