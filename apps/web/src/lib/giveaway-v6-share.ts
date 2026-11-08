import type { V6GiveawayShareInput } from "@kaspa-actions/agent";
import { restoreGiveawayV6Projection } from "@kaspa-actions/application";
import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";

/**
 * Share-card facts of a V6 giveaway, reconstructed with the same cross-checks
 * as its page. Null when the giveaway is not V6 or its state cannot be trusted.
 */
export async function loadV6GiveawayShareInput(
  publicId: string,
): Promise<V6GiveawayShareInput | null> {
  if (!isGiveawayV6CreationEnabled()) return null;
  const row = await prisma.giveaway.findUnique({
    select: {
      amountSompi: true,
      closesAt: true,
      publicId: true,
      title: true,
      v6Projection: {
        select: {
          anchorHash: true,
          checkpoint: true,
          config: true,
          covenantIdHex: true,
          cursorHash: true,
          family: true,
          frozenEntryCount: true,
          id: true,
          lastPageFingerprint: true,
          network: true,
          observedRegistrationCount: true,
          phase: true,
          syncRevision: true,
          terminalTransactionId: true,
          winnerScriptPublicKeyHex: true,
        },
      },
    },
    where: { drawProtocolVersion: 6, publicId },
  });
  if (!row?.v6Projection) return null;
  try {
    const restored = restoreGiveawayV6Projection(row.v6Projection);
    if (restored.family.prizeValueSompi !== row.amountSompi) return null;
    return {
      amountKas: formatSompiToKaspa(row.amountSompi),
      closesAt: row.closesAt,
      participantCap: restored.config.shardCount * restored.config.maxEntriesPerShard,
      participantCount:
        restored.snapshot.frozenEntryCount ?? restored.snapshot.observedRegistrationCount,
      phase: restored.snapshot.phase,
      publicId: row.publicId,
      title: row.title,
    };
  } catch {
    return null;
  }
}
