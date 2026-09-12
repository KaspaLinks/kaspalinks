export type CovenantDrawProof = {
  version: 3 | 4;
  entryHashes: string[];
  entriesRoot: string;
  seedHex: string;
  blockHash: string;
  blockBlueScore: string;
  targetBlueScore: string;
  digest: string;
  winnerIndex: number;
  winnerScriptHex: string;
  winnerAddress: string;
};
export async function verifyCovenantDrawProof(proof: CovenantDrawProof) {
  const bytes = (hex: string) => {
    if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error("Invalid proof bytes.");
    return Uint8Array.from(hex.match(/../g)!.map((v) => parseInt(v, 16)));
  };
  const hex = (value: ArrayBuffer) =>
    Array.from(new Uint8Array(value), (v) => v.toString(16).padStart(2, "0")).join("");
  const hash = async (value: string) => hex(await crypto.subtle.digest("SHA-256", bytes(value)));
  try {
    if (
      !proof.entryHashes.length ||
      proof.entryHashes.length > 100 ||
      proof.entryHashes.some((h) => !/^[0-9a-f]{64}$/.test(h)) ||
      new Set(proof.entryHashes).size !== proof.entryHashes.length
    )
      return false;
    if ([...proof.entryHashes].sort().join("") !== proof.entryHashes.join("")) return false;
    if (!/^[0-9a-f]{64}$/.test(proof.seedHex)) return false;
    if ((await hash(proof.entryHashes.join(""))) !== proof.entriesRoot) return false;
    const digest = await hash("03" + proof.seedHex + proof.entriesRoot);
    const index = new DataView(bytes(digest).buffer).getUint32(0, true) % proof.entryHashes.length;
    return (
      digest === proof.digest &&
      index === proof.winnerIndex &&
      (await hash(proof.winnerScriptHex)) === proof.entryHashes[index]
    );
  } catch {
    return false;
  }
}
