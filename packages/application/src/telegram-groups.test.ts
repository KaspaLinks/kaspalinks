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
  announceQueuedAt: null,
  closesAt: minutes(6 * 60),
  phase: "OPEN" as const,
  reminderQueuedAt: null,
  verificationPaused: false,
};

describe("nextTelegramGroupPost", () => {
  it("announces once the giveaway is live and not about to close", () => {
    expect(nextTelegramGroupPost(open, now)).toBe("announce");
    expect(nextTelegramGroupPost({ ...open, closesAt: minutes(9) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...open, verificationPaused: true }, now)).toBeNull();
  });

  it("waits while the giveaway is not funded and gives up a day after its draw time", () => {
    const unfunded = { ...open, phase: "AWAITING_ACTIVATION" as const };
    expect(nextTelegramGroupPost(unfunded, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...unfunded, phase: null }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...unfunded, closesAt: minutes(-25 * 60) }, now)).toBe("done");
  });

  it("reminds in the last hour only when the announcement was long enough before", () => {
    const announced = { ...open, announceQueuedAt: minutes(-5 * 60), closesAt: minutes(45) };
    expect(nextTelegramGroupPost(announced, now)).toBe("reminder");
    expect(nextTelegramGroupPost({ ...announced, closesAt: minutes(61) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...announced, closesAt: minutes(5) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...announced, announceQueuedAt: minutes(-60) }, now)).toBeNull();
    expect(nextTelegramGroupPost({ ...announced, reminderQueuedAt: minutes(-1) }, now)).toBeNull();
  });

  it("posts a result only for announced giveaways", () => {
    expect(
      nextTelegramGroupPost({ ...open, announceQueuedAt: minutes(-60), phase: "DRAWN" }, now),
    ).toBe("result");
    expect(
      nextTelegramGroupPost({ ...open, announceQueuedAt: minutes(-60), phase: "RETURNED" }, now),
    ).toBe("result");
    expect(nextTelegramGroupPost({ ...open, phase: "DRAWN" }, now)).toBe("done");
    expect(
      nextTelegramGroupPost({ ...open, announceQueuedAt: minutes(-60), phase: "FROZEN" }, now),
    ).toBeNull();
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
  function db(overrides: { giveaway?: unknown; group?: unknown; links?: number } = {}) {
    const telegramGroupGiveaway = {
      count: vi.fn().mockResolvedValue(overrides.links ?? 0),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
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

  it("links the creator's own live or unfunded giveaway", async () => {
    const { prisma, telegramGroupGiveaway, raw } = db();
    await expect(linkGiveawayToTelegramGroup(prisma, input, now)).resolves.toEqual({
      created: true,
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
            announceQueuedAt: null,
            giveaway: {
              closesAt: minutes(300),
              v6Projection: { lastErrorCode: null, phase: "OPEN" },
            },
            id: "link1",
            reminderQueuedAt: null,
          },
          {
            announceQueuedAt: null,
            giveaway: { closesAt: minutes(-2000), v6Projection: null },
            id: "link2",
            reminderQueuedAt: null,
          },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    await expect(
      queueTelegramGroupGiveawayPosts(prisma as unknown as PrismaClient, now),
    ).resolves.toEqual({ queued: 1 });
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
