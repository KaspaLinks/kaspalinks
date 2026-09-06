import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@kaspa-actions/db";
import { TelegramApiClient, TelegramApiError } from "@kaspa-actions/agent";
import { deliverOutbox } from "./outbox.ts";
function fixture(kind = "giveaway.result") {
  const row = {
    id: "out1",
    kind,
    attempts: 0,
    subscriptionId: "sub1",
    connectionId: "conn1",
    matchedRuleIds: [],
    payload:
      kind === "giveaway.result"
        ? { publicId: "g1", title: "Weekend", status: "DRAWN" }
        : {
            actionTitle: "Invoice",
            amountSompi: "100000000",
            txId: "a".repeat(64),
            explorerUrl: "https://kaspa.stream/transactions/test",
            supporterName: "Test Supporter",
            supporterMessage: "hello",
          },
  };
  const tx = {
    telegramOutbox: {
      findMany: vi.fn().mockResolvedValue([row]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    telegramGiveawaySubscription: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: "sub1",
          telegramUserId: "123",
          telegramChatId: "123",
          revokedAt: null,
          giveaway: { publicId: "g1" },
        }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    telegramConnection: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: "conn1",
          creatorId: "c1",
          telegramChatId: "123",
          blockedAt: null,
          notificationsEnabled: false,
          supporterDetailsEnabled: false,
        }),
      updateMany: vi.fn(),
    },
    notificationRule: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  return {
    tx,
    db: db as unknown as PrismaClient,
    client: { sendMessage } as unknown as TelegramApiClient,
    sendMessage,
  };
}
describe("Telegram outbox authorization and retries", () => {
  beforeEach(() => {
    process.env.TOCCATA_LAB_ENABLED = "true";
    process.env.GIVEAWAY_LAB_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
  });
  it("sends a public result without claiming the subscriber won", async () => {
    const f = fixture();
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "123", text: expect.stringContaining("result is ready") }),
    );
    expect(f.sendMessage.mock.calls[0]![0].text).not.toMatch(/you won|private|claim key/i);
  });
  it("suppresses a queued result after opt-out", async () => {
    const f = fixture();
    f.tx.telegramGiveawaySubscription.findUnique.mockResolvedValue({
      revokedAt: new Date(),
    } as never);
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it("fails closed when a subscription was deleted", async () => {
    const f = fixture();
    f.tx.telegramGiveawaySubscription.findUnique.mockResolvedValue(null);
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it("suppresses a payment after notifications and rules are off", async () => {
    const f = fixture("payment.confirmed");
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it("removes stored supporter details if the setting was revoked", async () => {
    const f = fixture("payment.confirmed");
    f.tx.telegramConnection.findUnique.mockResolvedValue({
      id: "conn1",
      creatorId: "c1",
      telegramChatId: "123",
      blockedAt: null,
      notificationsEnabled: true,
      supporterDetailsEnabled: false,
    });
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.sendMessage).toHaveBeenCalledTimes(1);
    expect(f.sendMessage.mock.calls[0]![0].text).not.toContain("Test Supporter");
  });
  it("dead-letters a bad message without revoking subscriptions", async () => {
    const f = fixture();
    f.sendMessage.mockRejectedValue(new TelegramApiError("Bad button", true, 400));
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.tx.telegramGiveawaySubscription.updateMany).not.toHaveBeenCalled();
    expect(f.tx.telegramConnection.updateMany).not.toHaveBeenCalled();
  });
  it("revokes unreachable subscriber reminders on Telegram 403", async () => {
    const f = fixture();
    f.sendMessage.mockRejectedValue(new TelegramApiError("Blocked", true, 403, undefined, true));
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.tx.telegramGiveawaySubscription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { telegramUserId: "123" } }),
    );
  });
  it("honors Telegram's longer retry_after", async () => {
    const f = fixture();
    const now = Date.now();
    f.sendMessage.mockRejectedValue(new TelegramApiError("Rate limited", false, 429, 120));
    await deliverOutbox(f.client, new Date(), f.db);
    const retry = f.tx.telegramOutbox.updateMany.mock.calls.find(
      ([arg]) => arg.data.attempts === 1,
    )![0];
    expect(retry.data.availableAt.getTime()).toBeGreaterThanOrEqual(now + 120000);
  });
});
