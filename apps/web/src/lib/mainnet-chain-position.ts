import { z } from "zod";

const decimalSchema = z
  .union([z.string().regex(/^[0-9]+$/u), z.number().int().nonnegative().safe()])
  .transform(String);

const blockDagInfoSchema = z
  .object({
    networkName: z.literal("kaspa-mainnet"),
    virtualDaaScore: decimalSchema,
  })
  .passthrough();

const blueScoreSchema = z
  .object({ blueScore: decimalSchema })
  .passthrough();

const REQUEST_TIMEOUT_MS = 7_000;
const TOCCATA_ACTIVATION_DAA = 474_165_565n;

async function readMainnetJson(path: string): Promise<unknown> {
  const configured = process.env.KASPA_MAINNET_INDEXER_URL?.trim();
  const baseUrl = (configured || "https://api.kaspa.org").replace(/\/+$/u, "");
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Mainnet chain data is unavailable.");
  return response.json();
}

/** Reads the two public chain counters committed by Giveaway V6 creation. */
export async function readCurrentMainnetChainPosition(): Promise<{
  blueScore: bigint;
  daa: bigint;
}> {
  const [dagData, blueScoreData] = await Promise.all([
    readMainnetJson("/info/blockdag"),
    readMainnetJson("/info/virtual-chain-blue-score"),
  ]);
  const dag = blockDagInfoSchema.parse(dagData);
  const score = blueScoreSchema.parse(blueScoreData);
  const daa = BigInt(dag.virtualDaaScore);
  const blueScore = BigInt(score.blueScore);
  if (daa <= TOCCATA_ACTIVATION_DAA || blueScore === 0n) {
    throw new Error("Toccata Mainnet chain position is unavailable.");
  }
  return { blueScore, daa };
}
