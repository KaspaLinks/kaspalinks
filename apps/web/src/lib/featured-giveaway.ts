import { restoreGiveawayV6Projection } from "@kaspa-actions/application";
import { GiveawayV6Phase, Network, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";

/**
 * The home page points visitors at one open Mainnet giveaway, because people
 * who land on a giveaway enter far more often than people who land on the home
 * page. Only numbers the covenant commits to are shown, never the creator's
 * title, so nobody can put their own text on the home page.
 */

/** Small test giveaways stay off the home page. */
export const FEATURED_GIVEAWAY_MIN_PRIZE_SOMPI = 10n * 100_000_000n;
/** An entry needs time to confirm, so a giveaway about to close is not worth a click. */
export const FEATURED_GIVEAWAY_MIN_REMAINING_MS = 15 * 60 * 1_000;
/** The home page must render even when the database is slow. */
const LOOKUP_TIMEOUT_MS = 1_500;
const CANDIDATES = 5;

export type FeaturedGiveaway = {
  amountKas: string;
  closesAt: Date;
  participantCap: number;
  participantCount: number;
  publicId: string;
};

export type FeaturedGiveawayCandidate = {
  amountSompi: bigint;
  closesAt: Date;
  participantCap: number;
  participantCount: number;
  publicId: string;
};

/** Biggest prize first, then the one closing soonest; full or nearly closed ones never. */
export function pickFeaturedGiveaway(
  candidates: readonly FeaturedGiveawayCandidate[],
  now: Date,
): FeaturedGiveaway | null {
  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.amountSompi >= FEATURED_GIVEAWAY_MIN_PRIZE_SOMPI &&
        candidate.closesAt.getTime() - now.getTime() >= FEATURED_GIVEAWAY_MIN_REMAINING_MS &&
        candidate.participantCount < candidate.participantCap,
    )
    .sort((a, b) =>
      a.amountSompi === b.amountSompi
        ? a.closesAt.getTime() - b.closesAt.getTime()
        : a.amountSompi > b.amountSompi
          ? -1
          : 1,
    );
  const chosen = eligible[0];
  if (!chosen) return null;
  return {
    amountKas: formatSompiToKaspa(chosen.amountSompi),
    closesAt: chosen.closesAt,
    participantCap: chosen.participantCap,
    participantCount: chosen.participantCount,
    publicId: chosen.publicId,
  };
}

export async function loadFeaturedGiveaway(now = new Date()): Promise<FeaturedGiveaway | null> {
  if (!isGiveawayV6CreationEnabled()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookUp(now),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookUp(now: Date): Promise<FeaturedGiveaway | null> {
  const rows = await prisma.giveaway.findMany({
    orderBy: [{ amountSompi: "desc" }, { closesAt: "asc" }],
    select: {
      amountSompi: true,
      closesAt: true,
      publicId: true,
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
    take: CANDIDATES,
    where: {
      amountSompi: { gte: FEATURED_GIVEAWAY_MIN_PRIZE_SOMPI },
      closesAt: { gt: new Date(now.getTime() + FEATURED_GIVEAWAY_MIN_REMAINING_MS) },
      drawProtocolVersion: 6,
      v6Projection: { lastErrorCode: null, network: Network.MAINNET, phase: GiveawayV6Phase.OPEN },
    },
  });

  const candidates: FeaturedGiveawayCandidate[] = [];
  for (const row of rows) {
    if (!row.v6Projection) continue;
    try {
      // The same cross-checks the giveaway page runs, so the banner never
      // links to a page that would refuse to show the giveaway.
      const restored = restoreGiveawayV6Projection(row.v6Projection);
      if (restored.snapshot.phase !== "open") continue;
      if (restored.family.prizeValueSompi !== row.amountSompi) continue;
      candidates.push({
        amountSompi: row.amountSompi,
        closesAt: row.closesAt,
        participantCap: restored.config.shardCount * restored.config.maxEntriesPerShard,
        participantCount: restored.snapshot.observedRegistrationCount,
        publicId: row.publicId,
      });
    } catch {
      // A giveaway whose state cannot be reconstructed is simply not featured.
    }
  }
  return pickFeaturedGiveaway(candidates, now);
}
