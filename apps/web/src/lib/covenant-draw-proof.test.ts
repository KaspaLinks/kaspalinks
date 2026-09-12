import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { verifyCovenantDrawProof, type CovenantDrawProof } from "./covenant-draw-proof";
const sha = (hex: string) => createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
const script = "000020" + "ab".repeat(32) + "ac";
const entryHashes = [sha(script)];
const entriesRoot = sha(entryHashes.join(""));
const seedHex = "11".repeat(32);
const proof: CovenantDrawProof = {
  version: 4,
  entryHashes,
  entriesRoot,
  seedHex,
  blockHash: "22".repeat(32),
  blockBlueScore: "1000",
  targetBlueScore: "1000",
  digest: sha("03" + seedHex + entriesRoot),
  winnerIndex: 0,
  winnerScriptHex: script,
  winnerAddress: "public-address-checked-by-sdk-in-ui",
};
describe("public draw calculation verification", () => {
  it("reproduces a one-participant draw", async () =>
    expect(await verifyCovenantDrawProof(proof)).toBe(true));
  it("rejects changed entropy, root, winner script, digest and duplicates", async () => {
    for (const patch of [
      { seedHex: "00".repeat(32) },
      { entriesRoot: "00".repeat(32) },
      { winnerScriptHex: "00" },
      { digest: "00".repeat(32) },
      { winnerIndex: 1 },
      { entryHashes: [...entryHashes, ...entryHashes] },
    ])
      expect(await verifyCovenantDrawProof({ ...proof, ...patch })).toBe(false);
  });
});
