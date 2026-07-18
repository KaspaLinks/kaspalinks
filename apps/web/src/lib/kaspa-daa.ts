import { z } from "zod";

const blockDagInfoSchema = z.object({
  networkName: z.literal("kaspa-mainnet"),
  virtualDaaScore: z.string().regex(/^[0-9]+$/),
});

export async function readCurrentMainnetDaaScore(): Promise<bigint> {
  const response = await fetch("https://api.kaspa.org/info/blockdag", {
    headers: { accept: "application/json" },
    next: { revalidate: 5 },
  });
  if (!response.ok) throw new Error("Could not read current Kaspa DAA score.");

  const parsed = blockDagInfoSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Unexpected Kaspa BlockDAG response.");
  return BigInt(parsed.data.virtualDaaScore);
}
