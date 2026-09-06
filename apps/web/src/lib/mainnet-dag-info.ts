import { z } from "zod";

const blockDagInfoSchema = z.object({
  networkName: z.literal("kaspa-mainnet"),
  pastMedianTime: z.string(),
  virtualDaaScore: z.string().regex(/^[0-9]+$/),
});

export type MainnetBlockDagInfo = z.infer<typeof blockDagInfoSchema>;

const CACHE_MAX_AGE_MS = 60_000;
let cachedDagInfo: null | { readAtMs: number; value: MainnetBlockDagInfo } = null;

export async function readResilientMainnetDagInfo(): Promise<MainnetBlockDagInfo> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("https://api.kaspa.org/info/blockdag", {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(7_000),
        next: { revalidate: 5 },
      });
      if (!response.ok) continue;

      const parsed = blockDagInfoSchema.safeParse(await response.json());
      if (!parsed.success) continue;

      cachedDagInfo = { readAtMs: Date.now(), value: parsed.data };
      return parsed.data;
    } catch {
      // Retry once before considering the short-lived validated fallback.
    }
  }

  if (cachedDagInfo && Date.now() - cachedDagInfo.readAtMs <= CACHE_MAX_AGE_MS) {
    return cachedDagInfo.value;
  }
  throw new Error("Current Kaspa BlockDAG info is unavailable.");
}

export function resetMainnetDagInfoCacheForTests(): void {
  cachedDagInfo = null;
}
