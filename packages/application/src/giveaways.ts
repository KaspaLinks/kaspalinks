import { AgentIntentStatus, GiveawayStatus, type PrismaClient } from "@kaspa-actions/db";
import { formatSompiToKaspa, parseKaspaAmountToSompi } from "@kaspa-actions/kaspa";
import { z } from "zod";

import type { ActorContext } from "./actor.ts";
import { ApplicationError } from "./errors.ts";

const GIVEAWAY_DRAFT_TTL_MS = 10 * 60_000;
const MIN_ENTRY_WINDOW_SECONDS = 60;
const MAX_ENTRY_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_WINNER_CLAIM_WINDOW_SECONDS = 24 * 60 * 60;

export const giveawaySetupDraftSchema = z
  .object({
    amountKas: z.string().trim(),
    entryWindowSeconds: z
      .number()
      .int()
      .min(MIN_ENTRY_WINDOW_SECONDS)
      .max(MAX_ENTRY_WINDOW_SECONDS),
    title: z.string().trim().min(1).max(80),
    winnerClaimWindowSeconds: z
      .number()
      .int()
      .min(60)
      .max(7 * 24 * 60 * 60)
      .default(DEFAULT_WINNER_CLAIM_WINDOW_SECONDS),
  })
  .strict();

export type GiveawaySetupDraftInput = z.input<typeof giveawaySetupDraftSchema>;

export async function createGiveawaySetupDraftTool(
  prisma: PrismaClient,
  actor: ActorContext,
  telegramUserId: string,
  rawInput: GiveawaySetupDraftInput,
  now = new Date(),
  sourceUpdateId?: string,
) {
  const parsed = giveawaySetupDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ApplicationError(
      "INVALID_GIVEAWAY_DRAFT",
      parsed.error.issues[0]?.message ?? "Invalid giveaway draft.",
    );
  }
  const amountSompi = parseKaspaAmountToSompi(parsed.data.amountKas);

  const data = {
    creatorId: actor.creatorId,
    expiresAt: new Date(now.getTime() + GIVEAWAY_DRAFT_TTL_MS),
    intent: "prepare_giveaway",
    payload: {
      ...parsed.data,
      amountKas: formatSompiToKaspa(amountSompi),
    },
    telegramUserId,
    ...(sourceUpdateId ? { sourceUpdateId } : {}),
  };
  if (!sourceUpdateId) return prisma.agentIntentDraft.create({ data });
  const draft = await prisma.agentIntentDraft.upsert({
    where: { sourceUpdateId },
    create: data,
    update: {},
  });
  if (draft.creatorId !== actor.creatorId || draft.telegramUserId !== telegramUserId) {
    throw new ApplicationError("DRAFT_OWNER_MISMATCH", "Draft is unavailable.", 409);
  }
  return draft;
}

export async function readGiveawaySetupDraftTool(
  prisma: PrismaClient,
  actor: ActorContext,
  draftId: string,
  now = new Date(),
) {
  const draft = await prisma.agentIntentDraft.findFirst({
    where: {
      creatorId: actor.creatorId,
      expiresAt: { gt: now },
      id: draftId,
      intent: "prepare_giveaway",
      status: AgentIntentStatus.PENDING_CONFIRMATION,
    },
  });
  if (!draft) {
    throw new ApplicationError(
      "GIVEAWAY_DRAFT_UNAVAILABLE",
      "Giveaway setup draft is missing or expired.",
      404,
    );
  }

  const parsed = giveawaySetupDraftSchema.safeParse(draft.payload);
  if (!parsed.success) {
    throw new ApplicationError("GIVEAWAY_DRAFT_INVALID", "Giveaway setup draft is invalid.", 409);
  }
  return { draft: parsed.data, expiresAt: draft.expiresAt, id: draft.id };
}

export async function listGiveawaysTool(prisma: PrismaClient, actor: ActorContext, limit = 10) {
  const giveaways = await prisma.giveaway.findMany({
    include: {
      _count: { select: { entries: true } },
      prizeLink: {
        select: {
          claimTxId: true,
          fundingTxId: true,
          refundTxId: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 25),
    where: { creatorId: actor.creatorId },
  });

  return giveaways.map((giveaway) => ({
    amountKas: formatSompiToKaspa(giveaway.amountSompi),
    closesAt: giveaway.closesAt,
    createdAt: giveaway.createdAt,
    entryCount: giveaway._count.entries,
    funded: giveaway.prizeLink ? giveaway.prizeLink.fundingTxId !== null : true,
    prizeStatus: giveaway.prizeLink?.status ?? null,
    publicId: giveaway.publicId,
    status: giveaway.status as GiveawayStatus,
    title: giveaway.title,
    winnerAddress: giveaway.winnerAddress,
    winnerClaimExpiresAt: giveaway.winnerClaimExpiresAt,
  }));
}
