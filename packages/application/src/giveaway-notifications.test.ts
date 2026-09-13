import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@kaspa-actions/db";
import {
  queueGiveawayResults,
  setGiveawayResultSubscription,
  stopGiveawayResultSubscriptions,
} from "./giveaway-notifications.ts";
function fixture() {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    giveaway: { findUnique: vi.fn().mockResolvedValue({ id: "g1", title: "Weekend" }) },
    telegramGiveawaySubscription: {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    telegramOutbox: {
      upsert: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { tx, prisma: db as unknown as PrismaClient };
}
const input = {
  publicId: "giveaway-1",
  telegramUserId: "123",
  telegramChatId: "123",
  enabled: true,
};
describe("Giveaway result subscriptions", () => {
  it("needs no Creator account and creates only an explicit private-chat subscription", async () => {
    const { tx, prisma } = fixture();
    await setGiveawayResultSubscription(prisma, input);
    expect(tx.telegramGiveawaySubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { giveawayId: "g1", telegramUserId: "123", telegramChatId: "123" },
      }),
    );
    expect(tx.telegramOutbox.upsert).not.toHaveBeenCalled();
  });
  it("rejects an attempt to subscribe another chat", async () => {
    const { tx, prisma } = fixture();
    await expect(
      setGiveawayResultSubscription(prisma, { ...input, telegramChatId: "456" }),
    ).rejects.toMatchObject({ code: "PRIVATE_CHAT_REQUIRED" });
    expect(tx.telegramGiveawaySubscription.upsert).not.toHaveBeenCalled();
  });
  it("bounds pending subscriptions while allowing idempotent repeats", async () => {
    const { tx, prisma } = fixture();
    tx.telegramGiveawaySubscription.count.mockResolvedValue(50);
    await expect(setGiveawayResultSubscription(prisma, input)).rejects.toMatchObject({
      code: "WATCH_LIMIT",
    });
    tx.telegramGiveawaySubscription.findUnique.mockResolvedValue({ revokedAt: null } as never);
    await expect(setGiveawayResultSubscription(prisma, input)).resolves.toMatchObject({
      enabled: true,
    });
  });
  it("stops only the authenticated user's reminders", async () => {
    const { tx, prisma } = fixture();
    await stopGiveawayResultSubscriptions(prisma, "123");
    expect(tx.telegramGiveawaySubscription.updateMany).toHaveBeenCalledWith({
      where: { telegramUserId: "123", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
  it("atomically claims and deduplicates results without winner or recovery secrets", async () => {
    const { tx, prisma } = fixture();
    tx.telegramGiveawaySubscription.findMany.mockResolvedValue([
      { id: "s1", giveaway: { publicId: "g1", title: "Weekend", status: "DRAWN" } },
    ] as never);
    tx.telegramGiveawaySubscription.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await queueGiveawayResults(prisma);
    await queueGiveawayResults(prisma);
    expect(tx.telegramOutbox.upsert).toHaveBeenCalledTimes(1);
    expect(tx.telegramOutbox.upsert.mock.calls[0]![0]).toMatchObject({
      where: { dedupeKey: "giveaway-result:s1" },
      create: {
        subscriptionId: "s1",
        kind: "giveaway.result",
        payload: { publicId: "g1", title: "Weekend", status: "DRAWN" },
      },
    });
    expect(JSON.stringify(tx.telegramOutbox.upsert.mock.calls)).not.toMatch(
      /seed|address|claim|refund|safeJson/i,
    );
  });
  it("re-enables only previously unsent result deliveries after explicit opt-in", async () => {
    const { tx, prisma } = fixture();
    tx.telegramGiveawaySubscription.findUnique.mockResolvedValue({
      id: "s1",
      revokedAt: new Date(),
      resultQueuedAt: new Date(),
    } as never);
    await setGiveawayResultSubscription(prisma, input);
    expect(tx.telegramOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { subscriptionId: "s1", sentAt: null, status: "DEAD", kind: "giveaway.result" },
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });
});
