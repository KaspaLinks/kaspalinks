import { prisma } from "@kaspa-actions/db";
import { AuditActorType, Network } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { readCreatorActionDailyLimit, rollingDailyWindowStart } from "@/lib/creator-auth";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { resolveClaimableOnChain } from "@/lib/claimable-onchain";
import { selectRotatingWindow } from "@/lib/claimable-refresh";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  ToccataLabSdkUnavailableError,
  validateRegisteredClaimableMetadata,
} from "@/lib/toccata-lab";
import { ZodError } from "zod";

// Server-side store for non-custodial claimable links. This holds ONLY
// non-secret metadata (funding address, public keys, status). The claim/refund
// private codes never reach the server — they stay in encrypted browser storage
// and URL fragments. This endpoint gives the creator a durable, cross-device
// list + accurate status; /my-links merges it with the browser-held secrets.

type ClaimableLinkRow = {
  id: string;
  linkKey: string;
  title: string;
  description: string | null;
  amountSompi: bigint;
  feeSompi: bigint;
  fundingAddress: string;
  claimPublicKey: string;
  refundPublicKey: string;
  refundLockTime: string;
  redeemScriptHex: string;
  fundingTxId: string | null;
  fundingOutputIndex: number | null;
  status: string;
  claimTxId: string | null;
  claimedAt: Date | null;
  refundTxId: string | null;
  refundedAt: Date | null;
  network: Network;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(link: ClaimableLinkRow) {
  return {
    id: link.id,
    linkKey: link.linkKey,
    title: link.title,
    description: link.description ?? "",
    amountSompi: link.amountSompi.toString(),
    feeSompi: link.feeSompi.toString(),
    fundingAddress: link.fundingAddress,
    claimPublicKey: link.claimPublicKey,
    refundPublicKey: link.refundPublicKey,
    refundLockTime: link.refundLockTime,
    redeemScriptHex: link.redeemScriptHex,
    fundingTxId: link.fundingTxId ?? null,
    fundingOutputIndex: link.fundingOutputIndex ?? null,
    claimTxId: link.claimTxId,
    claimedAt: link.claimedAt?.toISOString() ?? null,
    refundTxId: link.refundTxId,
    refundedAt: link.refundedAt?.toISOString() ?? null,
    status: link.status,
    network: link.network,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const NON_TERMINAL = new Set(["awaiting_funding", "funded", "shared", "refundable"]);
const DELETABLE_STATUSES = new Set(["claimed", "refunded", "spent_unknown"]);
const REFRESH_MAX = 8;
const REFRESH_THROTTLE_MS = 20_000;
// Per-creator throttle so repeated /my-links loads (incl. focus refreshes) don't
// hammer the indexer. Resets on restart; single-instance deployment.
const lastRefreshByCreator = new Map<string, number>();
const refreshCursorByCreator = new Map<string, number>();

async function maybeRefreshOnChain(creatorId: string, links: ClaimableLinkRow[]): Promise<void> {
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
        await prisma.claimableLink.update({ where: { id: link.id }, data });
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

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const links = await prisma.claimableLink.findMany({
    where: { creatorId: guard.creator.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  await maybeRefreshOnChain(guard.creator.id, links);

  return apiJson({ claimableLinks: links.map(serialize) });
}

export async function POST(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit(RateBuckets.CREATOR_ACTION_CREATE, guard.creator.id);
  if (!limited.allowed) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "claimable_link.rate_limited",
      ipHash: guard.ipHash,
    });
    return limited.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid JSON body.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid body.", 400);
  }
  const b = body as Record<string, unknown>;

  const linkKey = str(b.linkKey);
  const title = str(b.title);
  const amountSompi = str(b.amountSompi);
  const feeSompi = str(b.feeSompi);
  const fundingAddress = str(b.fundingAddress);
  const claimPublicKey = str(b.claimPublicKey);
  const refundPublicKey = str(b.refundPublicKey);
  const refundLockTime = str(b.refundLockTime);
  const redeemScriptHex = str(b.redeemScriptHex);
  const description = typeof b.description === "string" ? b.description.slice(0, 2000) : null;

  if (!linkKey || linkKey.length > 128) {
    return apiError(ErrorCodes.INVALID_BODY, "linkKey is required.", 400);
  }
  if (!title || title.length > 200) {
    return apiError(ErrorCodes.INVALID_BODY, "title is required.", 400);
  }
  let canonical;
  try {
    canonical = validateRegisteredClaimableMetadata({
      amountSompi,
      claimPublicKey,
      feeSompi,
      fundingAddress,
      redeemScriptHex,
      refundLockTime,
      refundPublicKey,
    });
  } catch (error) {
    if (error instanceof ToccataLabSdkUnavailableError) {
      return apiError(ErrorCodes.SERVER_ERROR, "Claimable link validation is unavailable.", 503);
    }
    const message =
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "Invalid claimable link metadata.")
        : error instanceof Error
          ? error.message
          : "Invalid claimable link metadata.";
    return apiError(ErrorCodes.INVALID_BODY, message, 400);
  }
  const immutableData = {
    title,
    description,
    ...canonical,
    network: Network.MAINNET,
  };

  const existing = await prisma.claimableLink.findUnique({ where: { linkKey } });
  if (existing) {
    if (
      existing.creatorId !== guard.creator.id ||
      !sameImmutableClaimable(existing, immutableData)
    ) {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Claimable link key is already registered with different metadata.",
        409,
      );
    }
    return apiJson({ claimableLink: serialize(existing) });
  }

  const since = rollingDailyWindowStart();
  const [claimableCount, actionCount] = await Promise.all([
    prisma.claimableLink.count({
      where: { creatorId: guard.creator.id, createdAt: { gte: since } },
    }),
    prisma.action.count({
      where: { creatorId: guard.creator.id, createdAt: { gte: since } },
    }),
  ]);
  const dailyLimit = readCreatorActionDailyLimit();
  if (claimableCount + actionCount >= dailyLimit) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "claimable_link.daily_limit_exceeded",
      ipHash: guard.ipHash,
      metadata: { dailyLimit },
    });
    return apiError(
      ErrorCodes.RATE_LIMITED,
      `Daily link creation limit of ${dailyLimit} reached.`,
      429,
    );
  }

  let link: ClaimableLinkRow;
  try {
    link = await prisma.claimableLink.create({
      data: {
        creatorId: guard.creator.id,
        linkKey,
        ...immutableData,
        status: "awaiting_funding",
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error, ["linkKey"])) {
      return apiError(ErrorCodes.INVALID_STATE, "Claimable link key is already registered.", 409);
    }
    throw error;
  }

  await writeAuditLog(prisma, {
    actorType: AuditActorType.CREATOR,
    creatorId: guard.creator.id,
    event: "claimable_link.created",
    ipHash: guard.ipHash,
    metadata: { linkKey },
  });

  return apiJson({ claimableLink: serialize(link) });
}

export function PATCH() {
  return apiMethodNotAllowed(["GET", "POST", "DELETE"]);
}

export async function DELETE(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const linkKey = str(url.searchParams.get("linkKey"));
  if (!linkKey || linkKey.length > 128) {
    return apiError(ErrorCodes.INVALID_BODY, "linkKey is required.", 400);
  }

  const link = await prisma.claimableLink.findUnique({
    where: { creatorId_linkKey: { creatorId: guard.creator.id, linkKey } },
  });

  if (!link) {
    return apiError(ErrorCodes.NOT_FOUND, "Claimable link not found.", 404);
  }

  if (link.deletedAt !== null) {
    return apiError(ErrorCodes.NOT_FOUND, "Claimable link not found.", 404);
  }

  let resolvedStatus = link.status;
  if (!DELETABLE_STATUSES.has(resolvedStatus)) {
    try {
      const onChain = await resolveClaimableOnChain({
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

      if (onChain) {
        resolvedStatus = onChain.status;
        await prisma.claimableLink.update({
          data: {
            ...(onChain.fundingOutputIndex !== undefined
              ? { fundingOutputIndex: onChain.fundingOutputIndex }
              : {}),
            ...(onChain.fundingTxId ? { fundingTxId: onChain.fundingTxId } : {}),
            status: onChain.status,
          },
          where: { id: link.id },
        });
      }
    } catch {
      return apiError(
        ErrorCodes.SERVER_ERROR,
        "Could not verify this claimable link on-chain. Try again later.",
        503,
      );
    }
  }

  const verifiedUnfunded = resolvedStatus === "awaiting_funding" && link.fundingTxId === null;
  if (!verifiedUnfunded && !DELETABLE_STATUSES.has(resolvedStatus)) {
    return apiError(
      ErrorCodes.INVALID_STATE,
      "This link still holds claimable KAS. Claim or refund it before deleting it.",
      409,
    );
  }

  await prisma.claimableLink.update({
    data: { deletedAt: new Date() },
    where: { id: link.id },
  });

  return apiJson({ deleted: true });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET", "POST", "PATCH", "DELETE"]);

function sameImmutableClaimable(
  existing: ClaimableLinkRow,
  expected: {
    amountSompi: bigint;
    claimPublicKey: string;
    description: string | null;
    feeSompi: bigint;
    fundingAddress: string;
    network: Network;
    redeemScriptHex: string;
    refundLockTime: string;
    refundPublicKey: string;
    title: string;
  },
): boolean {
  return (
    existing.amountSompi === expected.amountSompi &&
    existing.claimPublicKey === expected.claimPublicKey &&
    existing.description === expected.description &&
    existing.feeSompi === expected.feeSompi &&
    existing.fundingAddress === expected.fundingAddress &&
    existing.network === expected.network &&
    existing.redeemScriptHex === expected.redeemScriptHex &&
    existing.refundLockTime === expected.refundLockTime &&
    existing.refundPublicKey === expected.refundPublicKey &&
    existing.title === expected.title
  );
}

export { methodNotAllowed as PUT };
