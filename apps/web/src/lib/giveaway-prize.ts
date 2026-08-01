import { GiveawayStatus, prisma } from "@kaspa-actions/db";

import { resolveClaimableOnChain } from "./claimable-onchain";
import { GIVEAWAY_FUNDING_GRACE_SECONDS } from "./giveaway-prize-shared";

const REFRESH_THROTTLE_MS = 3_000;
const lastRefreshByLink = new Map<string, number>();

export type GiveawayPrizeLinkState = {
  amountSompi: bigint;
  claimTxId: null | string;
  createdAt: Date;
  feeSompi: bigint;
  fundingAddress: string;
  fundingOutputIndex: null | number;
  fundingTxId: null | string;
  id: string;
  linkKey: string;
  redeemScriptHex: string;
  refundLockTime: string;
  refundTxId: null | string;
  status: string;
};

export type GiveawayWithPrizeState = {
  closesAt: Date;
  createdAt: Date;
  entryWindowSeconds: null | number;
  id: string;
  openedAt: Date | null;
  prizeLink: GiveawayPrizeLinkState | null;
  status: string;
};

export async function reconcileGiveawayPrize<T extends GiveawayWithPrizeState>(
  giveaway: T,
  now = new Date(),
  options: { force?: boolean } = {},
): Promise<T> {
  if (!giveaway.prizeLink) return giveaway;

  let prizeLink = { ...giveaway.prizeLink };
  const lastRefresh = lastRefreshByLink.get(prizeLink.id) ?? 0;
  if (options.force || now.getTime() - lastRefresh >= REFRESH_THROTTLE_MS) {
    lastRefreshByLink.set(prizeLink.id, now.getTime());
    const update = await resolveClaimableOnChain({
      amountSompi: prizeLink.amountSompi.toString(),
      claimTxId: prizeLink.claimTxId,
      createdAtMs: prizeLink.createdAt.getTime(),
      fundingAddress: prizeLink.fundingAddress,
      fundingOutputIndex: prizeLink.fundingOutputIndex,
      fundingTxId: prizeLink.fundingTxId,
      refundLockTime: prizeLink.refundLockTime,
      refundTxId: prizeLink.refundTxId,
      status: prizeLink.status,
    });

    if (update) {
      await prisma.claimableLink.update({
        data: {
          ...(update.fundingOutputIndex !== undefined
            ? { fundingOutputIndex: update.fundingOutputIndex }
            : {}),
          ...(update.fundingTxId ? { fundingTxId: update.fundingTxId } : {}),
          status: update.status,
        },
        where: { id: prizeLink.id },
      });
      prizeLink = {
        ...prizeLink,
        fundingOutputIndex: update.fundingOutputIndex ?? prizeLink.fundingOutputIndex,
        fundingTxId: update.fundingTxId ?? prizeLink.fundingTxId,
        status: update.status,
      };
    }
  }

  if (
    giveaway.status === GiveawayStatus.OPEN &&
    giveaway.openedAt === null &&
    prizeLink.fundingTxId &&
    prizeLink.fundingOutputIndex !== null &&
    (prizeLink.status === "funded" || prizeLink.status === "shared") &&
    now.getTime() <= giveaway.prizeLink.createdAt.getTime() + GIVEAWAY_FUNDING_GRACE_SECONDS * 1_000
  ) {
    const entryWindowSeconds = normalizeEntryWindowSeconds(giveaway);
    const openedAt = now;
    const closesAt = new Date(openedAt.getTime() + entryWindowSeconds * 1_000);
    const activated = await prisma.giveaway.updateMany({
      data: { closesAt, entryWindowSeconds, openedAt },
      where: { id: giveaway.id, openedAt: null, status: GiveawayStatus.OPEN },
    });
    if (activated.count === 1) {
      return { ...giveaway, closesAt, entryWindowSeconds, openedAt, prizeLink };
    }
  }

  return { ...giveaway, prizeLink };
}

function normalizeEntryWindowSeconds(giveaway: GiveawayWithPrizeState): number {
  if (
    giveaway.entryWindowSeconds !== null &&
    Number.isInteger(giveaway.entryWindowSeconds) &&
    giveaway.entryWindowSeconds >= 30
  ) {
    return giveaway.entryWindowSeconds;
  }
  return Math.max(
    30,
    Math.ceil((giveaway.closesAt.getTime() - giveaway.createdAt.getTime()) / 1_000),
  );
}

export function resetGiveawayPrizeRefreshForTests(): void {
  lastRefreshByLink.clear();
}
