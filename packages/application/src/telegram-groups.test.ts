import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@kaspa-actions/db";

import {
  linkGiveawayToTelegramGroup,
  nextTelegramGroupPost,
  queueTelegramGroupGiveawayPosts,
  recordTelegramGroupMembership,
} from "./telegram-groups.ts";

const now = new Date("2026-11-09T12:00:00Z");
const minutes = (value: number) => new Date(now.getTime() + value * 60_000);

const open = {
  activationSubmittedAt: minutes(-30),
  announceQueuedAt: null,
  askQueuedAt: null,
  closesAt: minutes(6 * 60),
  phase: "OPEN" as const,
  postConfirmedAt: null,
  postDeclinedAt: null,
  reminderQueuedAt: null,
  verificationPaused: false,
};
const confirmed = { ...open, postConfirmedAt: minutes(-1) };

describe("nextTelegramGroupPost", () => {
  it("posts only after the admin chose to, while there is time to enter", () => {
    expect(nextTelegramGroupPost(confirmed, now)).toBe("announce");
    expect(nextTelegramGroupPost({ ...confirmed, closesAt: minutes(9) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...confirmed, verificationPaused: true }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...open, postDeclinedAt: minutes(-1) }, now)).toBeNull();
  });

  it("asks the admin privately once, a few minutes after activation", () => {
    expect(nextTelegramGroupPost(open, now)).toBe("ask");
    expect(nextTelegramGroupPost({ ...open, activationSubmittedAt: null }, now)).toBe("ask");
    expect(nextTelegramGroupPost({ ...open, activationSubmittedAt: minutes(-2) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...open, askQueuedAt: minutes(-10) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...open, closesAt: minutes(9) }, now)).toBeNull();
  });

  it("waits while the giveaway is not funded and gives up a day after its draw time", () => {
    const unfunded = { ...confirmed, phase: "AWAITING_ACTIVATION" as const };
    expect(nextTelegramGroupPost(unfunded, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...unfunded, phase: null }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...unfunded, closesAt: minutes(-25 * 60) }, now)).toBe("done");
  });

  it("reminds in the last hour only when the post was long enough before", () => {
    const announced = { ...confirmed, announceQueuedAt: minutes(-5 * 60), closesAt: minutes(45) };
    expect(nextTelegramGroupPost(announced, now)).toBe("reminder");
    expect(nextTelegramGroupPost({ ...announced, closesAt: minutes(61) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...announced, closesAt: minutes(5) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...announced, announceQueuedAt: minutes(-60) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...announced, reminderQueuedAt: minutes(-1) }, now)).toBeNull();
  });

  it("posts a result only for giveaways it posted", () => {
    const posted = { ...confirmed, announceQueuedAt: minutes(-60) };
    expect(nextTelegramGroupPost({ ...posted, phase: "DRAWN" }, now)).toBe("result");
    expect(nextTelegramGroupPost({ ...posted, phase: "RETURNED" }, now)).toBe("result");
    expect(nextTelegramGroupPost({ ...open, phase: "DRAWN" }, now)).toBe("done");
    expect(nextTelegramGroupPost({ ...posted, phase: "FROZEN" }, now)).toBeNull();
  });
});

describe("recordTelegramGroupMembership", () => {
  function db(existing: null | { removedAt: Date | null }) {
    const telegramGroup = {
      findUnique: vi.fn().mockResolvedValue(existing),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    };
    return { prisma: { telegramGroup } as unknown as PrismaClient, telegramGroup };
  }

  it("welcomes a new or returning group, not a promotion", async () => {
    expect(
      await recordTelegramGroupMembership(db(null).prisma, {
        active: true,
        chatId: "-1",
        title: "A",
      }),
    ).toEqual({ welcome: true });
    expect(
      await recordTelegramGroupMembership(db({ removedAt: now }).prisma, {
        active: true,
        chatId: "-1",
        title: "A",
      }),
    ).toEqual({ welcome: true });
    const promoted = db({ removedAt: null });
    expect(
      await recordTelegramGroupMembership(promoted.prisma, {
        active: true,
        chatId: "-1",
        title: null,
      }),
    ).toEqual({ welcome: false });
    expect(promoted.telegramGroup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { removedAt: null } }),
    );
  });

  it("marks the group removed when the bot leaves", async () => {
    const left = db({ removedAt: null });
    await recordTelegramGroupMembership(
      left.prisma,
      { active: false, chatId: "-1", title: null },
      now,
    );
    expect(left.telegramGroup.updateMany).toHaveBeenCalledWith({
      where: { chatId: "-1", removedAt: null },
      data: { removedAt: now },
    });
    expect(left.telegramGroup.upsert).not.toHaveBeenCalled();
  });
});

describe("linkGiveawayToTelegramGroup", () => {
  const input = { chatId: "-100", creatorId: "c1", publicId: "pub1", telegramUserId: "7" };
  function db(
    overrides: { existing?: unknown; giveaway?: unknown; group?: unknown; links?: number } = {},
  ) {
    const telegramGroupGiveaway = {
      count: vi.fn().mockResolvedValue(overrides.links ?? 0),
      findUnique: vi.fn().mockResolvedValue(overrides.existing ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockImplementation(async (args: { create: Record<string, unknown> }) => ({
        postConfirmedAt: args.create.postConfirmedAt ?? null,
        postDeclinedAt: args.create.postDeclinedAt ?? null,
      })),
    };
    const prisma = {
      giveaway: {
        findFirst: vi.fn().mockResolvedValue(
          "giveaway" in overrides
            ? overrides.giveaway
            : {
                closesAt: minutes(120),
                id: "g1",
                v6Bootstrap: { id: "b1" },
                v6Projection: { network: "MAINNET", phase: "OPEN" },
              },
        ),
      },
      telegramGroup: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            "group" in overrides ? overrides.group : { id: "grp1", removedAt: null, title: "Fans" },
          ),
      },
      telegramGroupGiveaway,
    };
    return { prisma: prisma as unknown as PrismaClient, telegramGroupGiveaway, raw: prisma };
  }

  it("links the creator's own live or unfunded giveaway without posting yet", async () => {
    const { prisma, telegramGroupGiveaway, raw } = db();
    await expect(linkGiveawayToTelegramGroup(prisma, input, now)).resolves.toEqual({
      created: true,
      state: "pending",
      title: "Fans",
    });
    expect(raw.giveaway.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { creatorId: "c1", drawProtocolVersion: 6, publicId: "pub1" },
      }),
    );
    expect(telegramGroupGiveaway.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { giveawayId: "g1", groupId: "grp1", linkedByTelegramUserId: "7" },
      }),
    );
  });

  it("records the admin's choice, and a post cannot be taken back", async () => {
    const fresh = db();
    await expect(
      linkGiveawayToTelegramGroup(fresh.prisma, { ...input, decision: "post" }, now),
    ).resolves.toMatchObject({ created: true, state: "confirmed" });
    expect(fresh.telegramGroupGiveaway.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ postConfirmedAt: now }) }),
    );

    const pending = db({ existing: { id: "l1", postConfirmedAt: null, postDeclinedAt: null } });
    await expect(
      linkGiveawayToTelegramGroup(pending.prisma, { ...input, decision: "skip" }, now),
    ).resolves.toMatchObject({ created: false, state: "declined" });
    expect(pending.telegramGroupGiveaway.updateMany).toHaveBeenCalledWith({
      where: { id: "l1", postConfirmedAt: null, postDeclinedAt: null },
      data: { postDeclinedAt: now },
    });

    // Declined first, posted later from the studio.
    const declined = db({ existing: { id: "l1", postConfirmedAt: null, postDeclinedAt: now } });
    await expect(
      linkGiveawayToTelegramGroup(declined.prisma, { ...input, decision: "post" }, now),
    ).resolves.toMatchObject({ state: "confirmed" });

    const posted = db({ existing: { id: "l1", postConfirmedAt: now, postDeclinedAt: null } });
    await expect(
      linkGiveawayToTelegramGroup(posted.prisma, { ...input, decision: "skip" }, now),
    ).resolves.toMatchObject({ state: "confirmed" });
    expect(posted.telegramGroupGiveaway.updateMany).not.toHaveBeenCalled();
  });

  it("refuses groups the bot left, foreign giveaways and closing giveaways", async () => {
    await expect(
      linkGiveawayToTelegramGroup(db({ group: { id: "g", removedAt: now } }).prisma, input, now),
    ).rejects.toMatchObject({ code: "GROUP_NOT_FOUND" });
    await expect(
      linkGiveawayToTelegramGroup(db({ giveaway: null }).prisma, input, now),
    ).rejects.toMatchObject({ code: "GIVEAWAY_NOT_FOUND" });
    await expect(
      linkGiveawayToTelegramGroup(
        db({
          giveaway: {
            closesAt: minutes(5),
            id: "g1",
            v6Bootstrap: { id: "b1" },
            v6Projection: null,
          },
        }).prisma,
        input,
        now,
      ),
    ).rejects.toMatchObject({ code: "GIVEAWAY_CLOSING" });
    await expect(
      linkGiveawayToTelegramGroup(
        db({
          giveaway: {
            closesAt: minutes(120),
            id: "g1",
            v6Bootstrap: { id: "b1" },
            v6Projection: { network: "MAINNET", phase: "DRAWN" },
          },
        }).prisma,
        input,
        now,
      ),
    ).rejects.toMatchObject({ code: "GIVEAWAY_CLOSING" });
    await expect(
      linkGiveawayToTelegramGroup(db({ links: 5 }).prisma, input, now),
    ).rejects.toMatchObject({ code: "GROUP_LIMIT" });
  });
});

describe("queueTelegramGroupGiveawayPosts", () => {
  const row = {
    announceQueuedAt: null,
    askQueuedAt: null,
    postConfirmedAt: null,
    postDeclinedAt: null,
    reminderQueuedAt: null,
  };
  it("claims each post once and queues it in the outbox", async () => {
    const tx = {
      telegramGroupGiveaway: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      telegramOutbox: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      telegramGroupGiveaway: {
        findMany: vi.fn().mockResolvedValue([
          {
            ...row,
            giveaway: {
              closesAt: minutes(300),
              v6Bootstrap: { activationSubmittedAt: minutes(-60) },
              v6Projection: { lastErrorCode: null, phase: "OPEN" },
            },
            id: "link1",
            postConfirmedAt: minutes(-1),
          },
          {
            ...row,
            giveaway: { closesAt: minutes(-2000), v6Bootstrap: null, v6Projection: null },
            id: "link2",
          },
          {
            ...row,
            giveaway: {
              closesAt: minutes(300),
              v6Bootstrap: { activationSubmittedAt: minutes(-60) },
              v6Projection: { lastErrorCode: null, phase: "OPEN" },
            },
            id: "link3",
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    await expect(
      queueTelegramGroupGiveawayPosts(prisma as unknown as PrismaClient, now),
    ).resolves.toEqual({ queued: 2 });
    // Not decided yet: the admin is asked, and only if nobody answered meanwhile.
    expect(tx.telegramGroupGiveaway.updateMany).toHaveBeenCalledWith({
      where: { askQueuedAt: null, id: "link3", postConfirmedAt: null, postDeclinedAt: null },
      data: { askQueuedAt: now },
    });
    expect(tx.telegramGroupGiveaway.updateMany).toHaveBeenCalledWith({
      where: { announceQueuedAt: null, id: "link1" },
      data: { announceQueuedAt: now },
    });
    expect(tx.telegramOutbox.upsert).toHaveBeenCalledWith({
      where: { dedupeKey: "group-giveaway:link1:announce" },
      update: {},
      create: {
        dedupeKey: "group-giveaway:link1:announce",
        kind: "group.giveaway",
        payload: { event: "announce", groupGiveawayId: "link1" },
      },
    });
    // A giveaway that never went live is dropped without a post.
    expect(prisma.telegramGroupGiveaway.updateMany).toHaveBeenCalledWith({
      where: { id: "link2", resultQueuedAt: null },
      data: { resultQueuedAt: now },
    });
  });
});
