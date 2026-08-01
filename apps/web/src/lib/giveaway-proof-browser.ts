import {
  giveawayDrawV2Preimage,
  giveawayEntryPreimage,
  giveawayFreezePreimage,
  giveawayMerkleEmptyPreimage,
  giveawayMerkleLeafPreimage,
  giveawayMerkleNodePreimage,
  giveawaySeedPreimage,
} from "./giveaway-proof-shared";

export type BrowserGiveawayDrawProof = {
  closesAt: string;
  digest: string;
  drawCommitment: string;
  entriesRoot: string;
  entryHashes: string[];
  entropyBlockBlueScore: string;
  entropyBlockHash: string;
  entropyTargetBlueScore: string;
  freezeCommitment: string;
  publicId: string;
  seed: string;
  winnerAddress: string;
  winnerIndex: number;
};

export type BrowserGiveawayVerification = {
  entryRootMatches: boolean;
  freezeCommitmentMatches: boolean;
  resultDigestMatches: boolean;
  seedCommitmentMatches: boolean;
  valid: boolean;
  winnerMatches: boolean;
};

export async function verifyGiveawayDrawInBrowser(
  proof: BrowserGiveawayDrawProof,
): Promise<BrowserGiveawayVerification> {
  validateProofShape(proof);
  const computedRoot = await computeBrowserMerkleRoot(proof.entryHashes);
  const computedSeedCommitment = await sha256Hex(giveawaySeedPreimage(proof.seed));
  const computedFreezeCommitment = await sha256Hex(
    giveawayFreezePreimage({
      closesAt: proof.closesAt,
      drawCommitment: proof.drawCommitment,
      entriesRoot: proof.entriesRoot,
      entryCount: proof.entryHashes.length,
      entropyTargetBlueScore: proof.entropyTargetBlueScore,
      publicId: proof.publicId,
    }),
  );
  const computedDigest = await sha256Hex(
    giveawayDrawV2Preimage({
      closesAt: proof.closesAt,
      drawCommitment: proof.drawCommitment,
      entriesRoot: proof.entriesRoot,
      entryCount: proof.entryHashes.length,
      entropyBlockBlueScore: proof.entropyBlockBlueScore,
      entropyBlockHash: proof.entropyBlockHash,
      entropyTargetBlueScore: proof.entropyTargetBlueScore,
      freezeCommitment: proof.freezeCommitment,
      publicId: proof.publicId,
      seedHex: proof.seed,
    }),
  );
  const computedWinnerIndex = Number(
    BigInt(`0x${computedDigest}`) % BigInt(proof.entryHashes.length),
  );
  const winnerHash = await sha256Hex(giveawayEntryPreimage(proof.winnerAddress));

  const result: BrowserGiveawayVerification = {
    entryRootMatches: computedRoot === proof.entriesRoot,
    freezeCommitmentMatches: computedFreezeCommitment === proof.freezeCommitment,
    resultDigestMatches: computedDigest === proof.digest,
    seedCommitmentMatches: computedSeedCommitment === proof.drawCommitment,
    valid: false,
    winnerMatches:
      computedWinnerIndex === proof.winnerIndex &&
      proof.entryHashes[computedWinnerIndex] === winnerHash,
  };
  result.valid =
    result.entryRootMatches &&
    result.freezeCommitmentMatches &&
    result.resultDigestMatches &&
    result.seedCommitmentMatches &&
    result.winnerMatches;
  return result;
}

async function computeBrowserMerkleRoot(entryHashes: string[]): Promise<string> {
  if (entryHashes.length === 0) return sha256Hex(giveawayMerkleEmptyPreimage());
  let level = await Promise.all(
    entryHashes.map((entryHash) => sha256Hex(giveawayMerkleLeafPreimage(entryHash))),
  );
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(await sha256Hex(giveawayMerkleNodePreimage(left, right)));
    }
    level = next;
  }
  return level[0]!;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateProofShape(proof: BrowserGiveawayDrawProof): void {
  const hashes = [
    proof.digest,
    proof.drawCommitment,
    proof.entriesRoot,
    proof.entropyBlockHash,
    proof.freezeCommitment,
    proof.seed,
    ...proof.entryHashes,
  ];
  if (
    proof.entryHashes.length === 0 ||
    hashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash)) ||
    proof.entryHashes.some(
      (entryHash, index) => index > 0 && proof.entryHashes[index - 1]! >= entryHash,
    ) ||
    !/^[0-9]+$/.test(proof.entropyTargetBlueScore) ||
    !/^[0-9]+$/.test(proof.entropyBlockBlueScore) ||
    BigInt(proof.entropyBlockBlueScore) < BigInt(proof.entropyTargetBlueScore) ||
    !Number.isInteger(proof.winnerIndex) ||
    proof.winnerIndex < 0 ||
    proof.winnerIndex >= proof.entryHashes.length
  ) {
    throw new Error("Giveaway draw proof has an invalid shape.");
  }
}
