export const GIVEAWAY_DRAW_V2_DOMAIN = "kaspa-links-giveaway-draw-v2";
export const GIVEAWAY_ENTRY_DOMAIN = "kaspa-links-giveaway-entry-v1";
export const GIVEAWAY_FREEZE_DOMAIN = "kaspa-links-giveaway-freeze-v2";
export const GIVEAWAY_MERKLE_EMPTY_DOMAIN = "kaspa-links-giveaway-merkle-empty-v1";
export const GIVEAWAY_MERKLE_LEAF_DOMAIN = "kaspa-links-giveaway-merkle-leaf-v1";
export const GIVEAWAY_MERKLE_NODE_DOMAIN = "kaspa-links-giveaway-merkle-node-v1";
export const GIVEAWAY_SEED_DOMAIN = "kaspa-links-giveaway-seed-v1";

export type GiveawayFreezeProofInput = {
  closesAt: string;
  drawCommitment: string;
  entriesRoot: string;
  entryCount: number;
  entropyTargetBlueScore: string;
  publicId: string;
};

export type GiveawayDrawV2ProofInput = GiveawayFreezeProofInput & {
  entropyBlockBlueScore: string;
  entropyBlockHash: string;
  freezeCommitment: string;
  seedHex: string;
};

export function giveawaySeedPreimage(seedHex: string): string {
  return `${GIVEAWAY_SEED_DOMAIN}\n${seedHex}`;
}

export function giveawayEntryPreimage(address: string): string {
  return `${GIVEAWAY_ENTRY_DOMAIN}\n${address}`;
}

export function giveawayMerkleEmptyPreimage(): string {
  return GIVEAWAY_MERKLE_EMPTY_DOMAIN;
}

export function giveawayMerkleLeafPreimage(entryHash: string): string {
  return `${GIVEAWAY_MERKLE_LEAF_DOMAIN}\n${entryHash}`;
}

export function giveawayMerkleNodePreimage(left: string, right: string): string {
  return `${GIVEAWAY_MERKLE_NODE_DOMAIN}\n${left}\n${right}`;
}

export function giveawayFreezePreimage(input: GiveawayFreezeProofInput): string {
  return [
    GIVEAWAY_FREEZE_DOMAIN,
    input.publicId,
    input.closesAt,
    input.drawCommitment,
    input.entriesRoot,
    input.entryCount.toString(),
    input.entropyTargetBlueScore,
  ].join("\n");
}

export function giveawayDrawV2Preimage(input: GiveawayDrawV2ProofInput): string {
  return [
    GIVEAWAY_DRAW_V2_DOMAIN,
    input.publicId,
    input.closesAt,
    input.drawCommitment,
    input.entriesRoot,
    input.entryCount.toString(),
    input.entropyTargetBlueScore,
    input.freezeCommitment,
    input.seedHex,
    input.entropyBlockBlueScore,
    input.entropyBlockHash,
  ].join("\n");
}
