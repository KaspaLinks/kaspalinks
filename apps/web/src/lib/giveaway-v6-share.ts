import type { V6GiveawayShareInput } from "@kaspa-actions/agent";
import { loadGiveawayV6PublicFacts } from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";

import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";

/**
 * Share-card facts of a V6 giveaway, reconstructed with the same cross-checks
 * as its page. Null when the giveaway is not V6 or its state cannot be trusted.
 */
export async function loadV6GiveawayShareInput(
  publicId: string,
): Promise<V6GiveawayShareInput | null> {
  if (!isGiveawayV6CreationEnabled()) return null;
  const facts = await loadGiveawayV6PublicFacts(prisma, { publicId });
  if (!facts) return null;
  return {
    amountKas: facts.amountKas,
    closesAt: facts.closesAt,
    participantCap: facts.participantCap,
    participantCount: facts.participantCount,
    phase: facts.phase,
    publicId: facts.publicId,
    title: facts.title,
  };
}
