import { GiveawayV6Phase, type Network, Prisma, type PrismaClient } from "@kaspa-actions/db";
import { formatSompiToKaspa, kaspaAddressFromScriptPublicKeyHex } from "@kaspa-actions/kaspa";

import { ApplicationError } from "./errors.ts";
import { restoreGiveawayV6Projection } from "./giveaway-v6-projection.ts";

// Telegram groups: a group admin sets up a giveaway for the group. Once it is
// live, the admin chooses whether the bot posts it there (in the studio or in
// answer to a private question); after a post come one reminder shortly before
// entries close, and the result. Only the group's chat id and title are stored.

/** A group admin can link a giveaway only while there is time left to enter. */
export const TELEGRAM_GROUP_MIN_TIME_LEFT_MS = 10 * 60_000;
/** The reminder goes out within the last hour of entries... */
export const TELEGRAM_GROUP_REMINDER_WINDOW_MS = 60 * 60_000;
/** ...but only for giveaways that were announced at least this long before. */
export const TELEGRAM_GROUP_REMINDER_MIN_GAP_MS = 3 * 60 * 60_000;
/** A giveaway that never went live stops being watched a day after its draw time. */
const UNFUNDED_GRACE_MS = 24 * 60 * 60_000;
export const TELEGRAM_GROUPS_PER_GIVEAWAY = 5;
/** /start right after the bot joined repeats the welcome; skip it. */
const WELCOME_REPEAT_MS = 2 * 60_000;

export type TelegramGroupPostEvent = "announce" | "ask" | "reminder" | "result";

const ACTIVE_MEMBER_STATUSES = new Set(["administrator", "creator", "member"]);

/** Whether the bot is a member of the chat after a my_chat_member update. */
export function isTelegramBotMemberStatus(status: string): boolean {
  return ACTIVE_MEMBER_STATUSES.has(status);
}

/** Records the bot joining or leaving a group. Returns whether to post the welcome. */
export async function recordTelegramGroupMembership(
  prisma: PrismaClient,
  input: { active: boolean; chatId: string; title: null | string },
  now = new Date(),
): Promise<{ welcome: boolean }> {
  if (!input.active) {
    await prisma.telegramGroup.updateMany({
      where: { chatId: input.chatId, removedAt: null },
      data: { removedAt: now },
    });
    return { welcome: false };
  }
  const existing = await prisma.telegramGroup.findUnique({
    select: { removedAt: true },
    where: { chatId: input.chatId },
  });
  // A promotion to admin is also a membership update; only a new join is welcomed.
  const joined = !existing || existing.removedAt !== null;
  await prisma.telegramGroup.upsert({
    where: { chatId: input.chatId },
    create: { chatId: input.chatId, title: input.title, welcomedAt: now },
    update: {
      removedAt: null,
      ...(input.title ? { title: input.title } : {}),
      ...(joined ? { welcomedAt: now } : {}),
    },
  });
  return { welcome: joined };
}

/**
 * Makes sure a group that sends the bot a command is known; the bot may have
 * joined before it listened for membership updates.
 */
export async function ensureTelegramGroup(
  prisma: PrismaClient,
  input: { chatId: string; title: null | string },
  now = new Date(),
): Promise<{ recentlyWelcomed: boolean; title: null | string }> {
  const group = await prisma.telegramGroup.upsert({
    where: { chatId: input.chatId },
    create: { chatId: input.chatId, title: input.title },
    update: { removedAt: null, ...(input.title ? { title: input.title } : {}) },
    select: { title: true, welcomedAt: true },
  });
  return {
    recentlyWelcomed:
      group.welcomedAt !== null && now.getTime() - group.welcomedAt.getTime() < WELCOME_REPEAT_MS,
    title: group.title,
  };
}

/** Records a welcome sent in answer to /start or /help. */
export async function markTelegramGroupWelcomed(
  prisma: PrismaClient,
  chatId: string,
  now = new Date(),
) {
  await prisma.telegramGroup.updateMany({ where: { chatId }, data: { welcomedAt: now } });
}

export async function markTelegramGroupRemoved(
  prisma: PrismaClient,
  chatId: string,
  now = new Date(),
) {
  await prisma.telegramGroup.updateMany({
    where: { chatId, removedAt: null },
    data: { removedAt: now },
  });
}

/** A group that became a supergroup continues under a new chat id. */
export async function migrateTelegramGroupChat(
  prisma: PrismaClient,
  fromChatId: string,
  toChatId: string,
) {
  if (fromChatId === toChatId) return;
  await prisma.$transaction(async (tx) => {
    const target = await tx.telegramGroup.findUnique({
      select: { id: true },
      where: { chatId: toChatId },
    });
    if (target) {
      // The supergroup already wrote to the bot; keep that row and move the links.
      const source = await tx.telegramGroup.findUnique({
        select: { id: true },
        where: { chatId: fromChatId },
      });
      if (!source) return;
      const links = await tx.telegramGroupGiveaway.findMany({
        select: { giveawayId: true, id: true },
        where: { groupId: source.id },
      });
      for (const link of links) {
        const duplicate = await tx.telegramGroupGiveaway.findUnique({
          select: { id: true },
          where: { groupId_giveawayId: { giveawayId: link.giveawayId, groupId: target.id } },
        });
        if (!duplicate)
          await tx.telegramGroupGiveaway.update({
            where: { id: link.id },
            data: { groupId: target.id },
          });
      }
      await tx.telegramGroup.update({ where: { id: source.id }, data: { removedAt: new Date() } });
      return;
    }
    await tx.telegramGroup.updateMany({
      where: { chatId: fromChatId },
      data: { chatId: toChatId },
    });
  });
}

export type GiveawayV6PublicFacts = {
  amountKas: string;
  closesAt: Date;
  network: Network;
  participantCap: number;
  participantCount: number;
  phase: "awaiting_activation" | "drawn" | "frozen" | "open" | "returned";
  publicId: string;
  title: string;
  /** Chain reconstruction is paused after an error; nothing should be announced. */
  verificationPaused: boolean;
  winnerAddress: null | string;
};

/**
 * Public facts of a V6 giveaway, reconstructed with the same cross-checks as
 * its page. Null when the giveaway is not V6 or its state cannot be trusted.
 */
export async function loadGiveawayV6PublicFacts(
  prisma: PrismaClient,
  where: { id: string } | { publicId: string },
): Promise<GiveawayV6PublicFacts | null> {
  const row = await prisma.giveaway.findFirst({
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
          lastErrorCode: true,
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
    where: { ...where, drawProtocolVersion: 6 },
  });
  if (!row?.v6Projection) return null;
  try {
    const restored = restoreGiveawayV6Projection(row.v6Projection);
    if (restored.family.prizeValueSompi !== row.amountSompi) return null;
    let winnerAddress: null | string = null;
    if (restored.snapshot.winner) {
      try {
        winnerAddress = kaspaAddressFromScriptPublicKeyHex(
          restored.snapshot.winner.payoutScriptPublicKeyHex,
          row.v6Projection.network === "MAINNET" ? "mainnet" : "testnet-10",
        );
      } catch {
        // A payout script without an address form is still a verified winner.
      }
    }
    return {
      amountKas: formatSompiToKaspa(row.amountSompi),
      closesAt: row.closesAt,
      network: row.v6Projection.network,
      participantCap: restored.config.shardCount * restored.config.maxEntriesPerShard,
      participantCount:
        restored.snapshot.frozenEntryCount ?? restored.snapshot.observedRegistrationCount,
      phase: restored.snapshot.phase,
      publicId: row.publicId,
      title: row.title,
      verificationPaused: row.v6Projection.lastErrorCode !== null,
      winnerAddress,
    };
  } catch {
    return null;
  }
}

export type TelegramGroupLinkState = "confirmed" | "declined" | "pending";
export type TelegramGroupPostDecision = "post" | "skip";

export function telegramGroupLinkState(row: {
  postConfirmedAt: Date | null;
  postDeclinedAt: Date | null;
}): TelegramGroupLinkState {
  return row.postConfirmedAt ? "confirmed" : row.postDeclinedAt ? "declined" : "pending";
}

/**
 * Links one of the creator's giveaways to a group whose admin the caller is,
 * and records their choice whether to post it there. Without a choice the
 * link waits; the bot asks once the giveaway is live. A post cannot be undone.
 */
export async function linkGiveawayToTelegramGroup(
  prisma: PrismaClient,
  input: {
    chatId: string;
    creatorId: string;
    decision?: TelegramGroupPostDecision;
    publicId: string;
    telegramUserId: string;
  },
  now = new Date(),
): Promise<{ created: boolean; state: TelegramGroupLinkState; title: null | string }> {
  const group = await prisma.telegramGroup.findUnique({
    select: { id: true, removedAt: true, title: true },
    where: { chatId: input.chatId },
  });
  if (!group || group.removedAt) {
    throw new ApplicationError("GROUP_NOT_FOUND", "The bot is no longer in this group.", 404);
  }
  const giveaway = await prisma.giveaway.findFirst({
    select: {
      closesAt: true,
      id: true,
      v6Bootstrap: { select: { id: true } },
      v6Projection: { select: { network: true, phase: true } },
    },
    where: { creatorId: input.creatorId, drawProtocolVersion: 6, publicId: input.publicId },
  });
  if (!giveaway?.v6Bootstrap) {
    throw new ApplicationError("GIVEAWAY_NOT_FOUND", "Giveaway not found.", 404);
  }
  const phase = giveaway.v6Projection?.phase ?? GiveawayV6Phase.AWAITING_ACTIVATION;
  if (
    (giveaway.v6Projection && giveaway.v6Projection.network !== "MAINNET") ||
    (phase !== GiveawayV6Phase.AWAITING_ACTIVATION && phase !== GiveawayV6Phase.OPEN) ||
    giveaway.closesAt.getTime() - now.getTime() < TELEGRAM_GROUP_MIN_TIME_LEFT_MS
  ) {
    throw new ApplicationError(
      "GIVEAWAY_CLOSING",
      "Entries close too soon to post this giveaway in the group.",
      409,
    );
  }
  const where = { groupId_giveawayId: { giveawayId: giveaway.id, groupId: group.id } };
  const existing = await prisma.telegramGroupGiveaway.findUnique({
    select: { id: true, postConfirmedAt: true, postDeclinedAt: true },
    where,
  });
  const decided =
    input.decision === "post"
      ? { postConfirmedAt: now }
      : input.decision === "skip"
        ? { postDeclinedAt: now }
        : {};
  if (!existing) {
    const links = await prisma.telegramGroupGiveaway.count({ where: { giveawayId: giveaway.id } });
    if (links >= TELEGRAM_GROUPS_PER_GIVEAWAY) {
      throw new ApplicationError(
        "GROUP_LIMIT",
        `A giveaway can be posted in up to ${TELEGRAM_GROUPS_PER_GIVEAWAY} groups.`,
        409,
      );
    }
    const created = await prisma.telegramGroupGiveaway.upsert({
      where,
      create: {
        giveawayId: giveaway.id,
        groupId: group.id,
        linkedByTelegramUserId: input.telegramUserId,
        ...decided,
      },
      update: {},
      select: { postConfirmedAt: true, postDeclinedAt: true },
    });
    return { created: true, state: telegramGroupLinkState(created), title: group.title };
  }
  if (input.decision === "post" && !existing.postConfirmedAt) {
    await prisma.telegramGroupGiveaway.updateMany({
      where: { id: existing.id, postConfirmedAt: null },
      data: { postConfirmedAt: now },
    });
    return { created: false, state: "confirmed", title: group.title };
  }
  if (input.decision === "skip" && !existing.postConfirmedAt && !existing.postDeclinedAt) {
    await prisma.telegramGroupGiveaway.updateMany({
      where: { id: existing.id, postConfirmedAt: null, postDeclinedAt: null },
      data: { postDeclinedAt: now },
    });
    return { created: false, state: "declined", title: group.title };
  }
  return { created: false, state: telegramGroupLinkState(existing), title: group.title };
}

/** One group link with what a private "Post in group?" answer needs to check. */
export async function loadTelegramGroupLink(prisma: PrismaClient, linkId: string) {
  return prisma.telegramGroupGiveaway.findUnique({
    select: {
      giveaway: { select: { creatorId: true, publicId: true, title: true } },
      group: { select: { chatId: true, removedAt: true, title: true } },
      linkedByTelegramUserId: true,
      postConfirmedAt: true,
      postDeclinedAt: true,
    },
    where: { id: linkId },
  });
}

/** The private question waits this long after activation, so the studio can answer first. */
export const TELEGRAM_GROUP_ASK_DELAY_MS = 3 * 60_000;

export type TelegramGroupPostCandidate = {
  activationSubmittedAt: Date | null;
  announceQueuedAt: Date | null;
  askQueuedAt: Date | null;
  closesAt: Date;
  phase: GiveawayV6Phase | null;
  postConfirmedAt: Date | null;
  postDeclinedAt: Date | null;
  reminderQueuedAt: Date | null;
  verificationPaused: boolean;
};

/**
 * What to do next for one linked giveaway. "done" stops watching it without a
 * post (e.g. it never went live, or closed before it could be announced).
 */
export function nextTelegramGroupPost(
  row: TelegramGroupPostCandidate,
  now: Date,
): TelegramGroupPostEvent | "done" | null {
  const left = row.closesAt.getTime() - now.getTime();
  const phase = row.phase ?? GiveawayV6Phase.AWAITING_ACTIVATION;
  if (phase === GiveawayV6Phase.DRAWN || phase === GiveawayV6Phase.RETURNED) {
    return row.announceQueuedAt ? "result" : "done";
  }
  if (phase === GiveawayV6Phase.AWAITING_ACTIVATION) {
    return left < -UNFUNDED_GRACE_MS ? "done" : null;
  }
  if (phase !== GiveawayV6Phase.OPEN || row.verificationPaused) return null;
  if (!row.announceQueuedAt) {
    if (left < TELEGRAM_GROUP_MIN_TIME_LEFT_MS) return null;
    if (row.postConfirmedAt) return "announce";
    if (
      !row.postDeclinedAt &&
      !row.askQueuedAt &&
      (row.activationSubmittedAt === null ||
        now.getTime() - row.activationSubmittedAt.getTime() >= TELEGRAM_GROUP_ASK_DELAY_MS)
    ) {
      return "ask";
    }
    return null;
  }
  if (
    !row.reminderQueuedAt &&
    left <= TELEGRAM_GROUP_REMINDER_WINDOW_MS &&
    left >= TELEGRAM_GROUP_MIN_TIME_LEFT_MS &&
    row.closesAt.getTime() - row.announceQueuedAt.getTime() >= TELEGRAM_GROUP_REMINDER_MIN_GAP_MS
  ) {
    return "reminder";
  }
  return null;
}

function claimFor(
  event: TelegramGroupPostEvent,
  id: string,
  now: Date,
): Prisma.TelegramGroupGiveawayUpdateManyArgs {
  switch (event) {
    case "ask":
      return {
        data: { askQueuedAt: now },
        where: { askQueuedAt: null, id, postConfirmedAt: null, postDeclinedAt: null },
      };
    case "announce":
      return { data: { announceQueuedAt: now }, where: { announceQueuedAt: null, id } };
    case "reminder":
      return { data: { reminderQueuedAt: now }, where: { id, reminderQueuedAt: null } };
    case "result":
      return { data: { resultQueuedAt: now }, where: { id, resultQueuedAt: null } };
  }
}

/** Queues due group posts into the Telegram outbox; the worker sends them. */
export async function queueTelegramGroupGiveawayPosts(prisma: PrismaClient, now = new Date()) {
  const rows = await prisma.telegramGroupGiveaway.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      announceQueuedAt: true,
      askQueuedAt: true,
      id: true,
      postConfirmedAt: true,
      postDeclinedAt: true,
      reminderQueuedAt: true,
      giveaway: {
        select: {
          closesAt: true,
          v6Bootstrap: { select: { activationSubmittedAt: true } },
          v6Projection: { select: { lastErrorCode: true, phase: true } },
        },
      },
    },
    take: 100,
    where: { group: { removedAt: null }, resultQueuedAt: null },
  });
  let queued = 0;
  for (const row of rows) {
    const next = nextTelegramGroupPost(
      {
        activationSubmittedAt: row.giveaway.v6Bootstrap?.activationSubmittedAt ?? null,
        announceQueuedAt: row.announceQueuedAt,
        askQueuedAt: row.askQueuedAt,
        closesAt: row.giveaway.closesAt,
        phase: row.giveaway.v6Projection?.phase ?? null,
        postConfirmedAt: row.postConfirmedAt,
        postDeclinedAt: row.postDeclinedAt,
        reminderQueuedAt: row.reminderQueuedAt,
        verificationPaused: (row.giveaway.v6Projection?.lastErrorCode ?? null) !== null,
      },
      now,
    );
    if (!next) continue;
    if (next === "done") {
      await prisma.telegramGroupGiveaway.updateMany({
        where: { id: row.id, resultQueuedAt: null },
        data: { resultQueuedAt: now },
      });
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.telegramGroupGiveaway.updateMany(claimFor(next, row.id, now));
      if (claimed.count !== 1) return;
      const dedupeKey = `group-giveaway:${row.id}:${next}`;
      await tx.telegramOutbox.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          kind: "group.giveaway",
          payload: { event: next, groupGiveawayId: row.id },
        },
      });
      queued += 1;
    });
  }
  return { queued };
}
