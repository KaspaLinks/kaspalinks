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

  const response = await fetch(
    `${KASPA_REST_BASE_URL}/blocks-from-bluescore?blueScoreGte=${targetBlueScore.toString()}&includeTransactions=false`,
    { cache: "no-store", headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new Error("Kaspa entropy block is unavailable.");

  const parsed = chainBlocksSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Kaspa entropy block response is invalid.");

  const confirmedLimit = currentBlueScore - GIVEAWAY_ENTROPY_CONFIRMATION_BLUE_SCORE_OFFSET;
  const candidates = parsed.data
    .filter((block) => block.verboseData.isChainBlock)
    .map((block) => ({
      blockBlueScore: BigInt(block.header.blueScore),
      blockHash: block.verboseData.hash.toLowerCase(),
    }))
    .filter(
      (block) => block.blockBlueScore >= targetBlueScore && block.blockBlueScore <= confirmedLimit,
    )
    .sort((left, right) => {
      if (left.blockBlueScore !== right.blockBlueScore) {
        return left.blockBlueScore < right.blockBlueScore ? -1 : 1;
      }
      return left.blockHash.localeCompare(right.blockHash);
    });

  const selected = candidates[0];
  if (!selected) throw new Error("Confirmed Kaspa entropy block could not be resolved.");
  return { ...selected, currentBlueScore, ready: true };
}
