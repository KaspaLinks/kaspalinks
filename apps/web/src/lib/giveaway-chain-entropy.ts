import { z } from "zod";

const virtualBlueScoreSchema = z.object({
  blueScore: z.number().int().nonnegative(),
});

const chainBlockSchema = z.object({
  header: z.object({
    blueScore: z.string().regex(/^[0-9]+$/),
  }),
  verboseData: z.object({
    hash: z.string().regex(/^[0-9a-f]{64}$/i),
    isChainBlock: z.boolean(),
  }),
});

const chainBlocksSchema = z.array(chainBlockSchema);

export const GIVEAWAY_ENTROPY_FUTURE_BLUE_SCORE_OFFSET = 100n;
export const GIVEAWAY_ENTROPY_CONFIRMATION_BLUE_SCORE_OFFSET = 100n;

const KASPA_REST_BASE_URL = "https://api.kaspa.org";
const MAX_ENTROPY_BLOCK_LOOKUPS = 128;

export type GiveawayChainEntropy = {
  blockBlueScore: bigint;
  blockHash: string;
  currentBlueScore: bigint;
  ready: true;
};

export type GiveawayChainEntropyPending = {
  currentBlueScore: bigint;
  ready: false;
  requiredBlueScore: bigint;
};

export async function readCurrentMainnetVirtualBlueScore(): Promise<bigint> {
  const response = await fetch(`${KASPA_REST_BASE_URL}/info/virtual-chain-blue-score`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Kaspa virtual-chain score is unavailable.");

  const parsed = virtualBlueScoreSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Kaspa virtual-chain score response is invalid.");
  return BigInt(parsed.data.blueScore);
}

export async function readConfirmedGiveawayChainEntropy(
  targetBlueScore: bigint,
): Promise<GiveawayChainEntropy | GiveawayChainEntropyPending> {
  if (targetBlueScore < 0n) throw new Error("Giveaway entropy target is invalid.");

  const currentBlueScore = await readCurrentMainnetVirtualBlueScore();
  const requiredBlueScore = targetBlueScore + GIVEAWAY_ENTROPY_CONFIRMATION_BLUE_SCORE_OFFSET;
  if (currentBlueScore < requiredBlueScore) {
    return { currentBlueScore, ready: false, requiredBlueScore };
  }

  const confirmedLimit = currentBlueScore - GIVEAWAY_ENTROPY_CONFIRMATION_BLUE_SCORE_OFFSET;
  let cursor = targetBlueScore;

  // The REST endpoint returns blocks at the first available blue score, which
  // may contain only non-chain blocks. Advance past that score until the first
  // confirmed virtual-chain block is found.
  for (let lookup = 0; lookup < MAX_ENTROPY_BLOCK_LOOKUPS && cursor <= confirmedLimit; lookup += 1) {
    const response = await fetch(
      `${KASPA_REST_BASE_URL}/blocks-from-bluescore?blueScoreGte=${cursor.toString()}&includeTransactions=false`,
      { cache: "no-store", headers: { accept: "application/json" } },
    );
    if (!response.ok) throw new Error("Kaspa entropy block is unavailable.");

    const parsed = chainBlocksSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error("Kaspa entropy block response is invalid.");
    if (parsed.data.length === 0) break;

    const blocks = parsed.data
      .map((block) => ({
        blockBlueScore: BigInt(block.header.blueScore),
        blockHash: block.verboseData.hash.toLowerCase(),
        isChainBlock: block.verboseData.isChainBlock,
      }))
      .filter((block) => block.blockBlueScore >= cursor)
      .sort((left, right) => {
        if (left.blockBlueScore !== right.blockBlueScore) {
          return left.blockBlueScore < right.blockBlueScore ? -1 : 1;
        }
        return left.blockHash.localeCompare(right.blockHash);
      });

    const selected = blocks.find(
      (block) => block.isChainBlock && block.blockBlueScore <= confirmedLimit,
    );
    if (selected) {
      return {
        blockBlueScore: selected.blockBlueScore,
        blockHash: selected.blockHash,
        currentBlueScore,
        ready: true,
      };
    }

    const lastBlock = blocks.at(-1);
    if (!lastBlock || lastBlock.blockBlueScore >= confirmedLimit) break;
    cursor = lastBlock.blockBlueScore + 1n;
  }

  throw new Error("Confirmed Kaspa entropy block could not be resolved.");
}
