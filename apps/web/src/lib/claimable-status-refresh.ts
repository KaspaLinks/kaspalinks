import { prisma } from "@kaspa-actions/db";

import { resolveClaimableOnChain } from "@/lib/claimable-onchain";
import { selectRotatingWindow } from "@/lib/claimable-refresh";
import type { ClaimableLinkRow } from "@/lib/claimable-registration";

// Claim links only learn about their funding, claim or expiry when a creator's
// list asks the chain. Both /my-links and the Telegram Mini App's "My links" call
// this, so the stored status catches up with the chain.

const NON_TERMINAL = new Set(["awaiting_funding", "funded", "shared", "refundable"]);
const REFRESH_MAX = 8;
const REFRESH_THROTTLE_MS = 20_000;
// Per-creator throttle so repeated list loads (incl. focus refreshes) don't
// hammer the indexer. Resets on restart; single-instance deployment.
const lastRefreshByCreator = new Map<string, number>();
const refreshCursorByCreator = new Map<string, number>();

export type RefreshableClaimableLink = Pick<
  ClaimableLinkRow,
  | "amountSompi"
  | "claimTxId"
  | "createdAt"
  | "fundingAddress"
  | "fundingOutputIndex"
  | "fundingTxId"
  | "id"
  | "refundLockTime"
  | "refundTxId"
  | "status"
  | "updatedAt"
>;

export async function refreshClaimableStatusesOnChain(
  creatorId: string,
  links: RefreshableClaimableLink[],
): Promise<void> {
  const now = Date.now();
  if (now - (lastRefreshByCreator.get(creatorId) ?? 0) < REFRESH_THROTTLE_MS) return;
  lastRefreshByCreator.set(creatorId, now);

  const refreshable = links.filter((link) => NON_TERMINAL.has(link.status));
  if (refreshable.length === 0) return;
  const cursor = (refreshCursorByCreator.get(creatorId) ?? 0) % refreshable.length;
  const selection = selectRotatingWindow(refreshable, cursor, REFRESH_MAX);
  const candidates = selection.items;
  refreshCursorByCreator.set(creatorId, selection.nextCursor);

  await Promise.all(
    candidates.map(async (link) => {
      try {
        const update = await resolveClaimableOnChain({
          amountSompi: link.amountSompi.toString(),
          claimTxId: link.claimTxId,
          createdAtMs: link.createdAt.getTime(),
          fundingAddress: link.fundingAddress,
          fundingOutputIndex: link.fundingOutputIndex,
          fundingTxId: link.fundingTxId,
          refundLockTime: link.refundLockTime,
          refundTxId: link.refundTxId,
          status: link.status,
        });
        if (!update) return;
        const data: { status: string; fundingTxId?: string; fundingOutputIndex?: number } = {
          status: update.status,
        };
        if (update.fundingTxId) data.fundingTxId = update.fundingTxId;
        if (update.fundingOutputIndex !== undefined) {
          data.fundingOutputIndex = update.fundingOutputIndex;
        }
        const changed = await prisma.claimableLink.updateMany({
          where: { id: link.id, updatedAt: link.updatedAt, status: link.status, deletedAt: null },
          data,
        });
        if (changed.count !== 1) {
          const current = await prisma.claimableLink.findUnique({ where: { id: link.id } });
          if (current) Object.assign(link, current);
          return;
        }
        link.status = update.status;
        if (update.fundingTxId) link.fundingTxId = update.fundingTxId;
        if (update.fundingOutputIndex !== undefined) {
          link.fundingOutputIndex = update.fundingOutputIndex;
        }
      } catch {
        // Best-effort: indexer hiccups must not break the list.
      }
    }),
  );
}
