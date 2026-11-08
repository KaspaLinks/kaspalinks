import { GiveawayV6Phase, Network, Prisma, prisma } from "@kaspa-actions/db";

/**
 * Public-stats pieces for SilverScript V6 giveaways. The older covenant
 * prototypes report payouts through audit events; V6 giveaways do not, so
 * their numbers come from the chain projection instead. Only Mainnet
 * giveaways whose prize was activated on-chain count: an unfunded draft is
 * not a giveaway anyone could enter.
 */

/** Drawn V6 giveaways as confirmed events: the prize paid to the winner. */
export const V6_DRAWN_GIVEAWAY_EVENTS = Prisma.sql`
  SELECT g."amountSompi"::bigint AS "amountSompi",
         COALESCE(g."drawnAt", p."updatedAt") AS "confirmedAt"
  FROM "Giveaway" g
  JOIN "GiveawayV6Projection" p ON p."giveawayId" = g.id
  WHERE g."drawProtocolVersion" = 6
    AND p.network = 'MAINNET'
    AND p.phase = 'DRAWN'
    AND p."terminalTransactionId" IS NOT NULL
`;

/** The same payouts as rows for the "Recent confirmations" list. */
export const V6_DRAWN_GIVEAWAY_RECENT = Prisma.sql`
  SELECT g."amountSompi"::bigint AS "amountSompi",
         COALESCE(g."drawnAt", p."updatedAt") AS "confirmedAt",
         'MAINNET'::text AS network,
         p."terminalTransactionId" AS "txId",
         'kaspa.giveaway'::text AS type,
         g."createdAt" AS "sortCreatedAt"
  FROM "Giveaway" g
  JOIN "GiveawayV6Projection" p ON p."giveawayId" = g.id
  WHERE g."drawProtocolVersion" = 6
    AND p.network = 'MAINNET'
    AND p.phase = 'DRAWN'
    AND p."terminalTransactionId" IS NOT NULL
`;

/** One row per drawn V6 giveaway for the payments-by-category breakdown. */
export const V6_DRAWN_GIVEAWAY_TYPES = Prisma.sql`
  SELECT 'kaspa.giveaway'::text AS type
  FROM "Giveaway" g
  JOIN "GiveawayV6Projection" p ON p."giveawayId" = g.id
  WHERE g."drawProtocolVersion" = 6
    AND p.network = 'MAINNET'
    AND p.phase = 'DRAWN'
    AND p."terminalTransactionId" IS NOT NULL
`;

/** Prisma filter for a creator with at least one activated Mainnet V6 giveaway. */
export function activatedV6GiveawayFilter(since?: Date) {
  return {
    giveaways: {
      some: {
        ...(since ? { createdAt: { gte: since } } : {}),
        drawProtocolVersion: 6,
        v6Projection: {
          network: Network.MAINNET,
          phase: { not: GiveawayV6Phase.AWAITING_ACTIVATION },
        },
      },
    },
  };
}

export type V6GiveawayStats = {
  /** Activated giveaways, all time and created in the last seven days. */
  run: number;
  runDelta7d: number;
  /** Confirmed on-chain entries across those giveaways. */
  entries: number;
  /** Giveaways whose winner was paid, and the KAS they received in total. */
  winnersPaid: number;
  paidSompi: bigint;
};

type V6GiveawayStatsRow = {
  entries: bigint | null;
  paidSompi: bigint | null;
  run: bigint;
  runDelta7d: bigint;
  winnersPaid: bigint;
};

export async function loadV6GiveawayStats(sevenDaysAgo: Date): Promise<V6GiveawayStats> {
  const [row] = await prisma.$queryRaw<V6GiveawayStatsRow[]>`
    SELECT COUNT(*)::bigint AS run,
           COUNT(*) FILTER (WHERE g."createdAt" >= ${sevenDaysAgo})::bigint AS "runDelta7d",
           SUM(COALESCE(p."frozenEntryCount", p."observedRegistrationCount"))::bigint AS entries,
           COUNT(*) FILTER (WHERE p.phase = 'DRAWN' AND p."terminalTransactionId" IS NOT NULL)::bigint
             AS "winnersPaid",
           SUM(g."amountSompi") FILTER (
             WHERE p.phase = 'DRAWN' AND p."terminalTransactionId" IS NOT NULL
           )::bigint AS "paidSompi"
    FROM "Giveaway" g
    JOIN "GiveawayV6Projection" p ON p."giveawayId" = g.id
    WHERE g."drawProtocolVersion" = 6
      AND p.network = 'MAINNET'
      AND p.phase <> 'AWAITING_ACTIVATION'
  `;
  return {
    entries: Number(row?.entries ?? 0n),
    paidSompi: row?.paidSompi ?? 0n,
    run: Number(row?.run ?? 0n),
    runDelta7d: Number(row?.runDelta7d ?? 0n),
    winnersPaid: Number(row?.winnersPaid ?? 0n),
  };
}
