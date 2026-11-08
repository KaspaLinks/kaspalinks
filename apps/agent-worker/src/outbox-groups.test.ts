import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@kaspa-actions/db";
import { TelegramApiClient, TelegramApiError } from "@kaspa-actions/agent";

const application = vi.hoisted(() => ({
  loadGiveawayV6PublicFacts: vi.fn(),
  markTelegramGroupRemoved: vi.fn(),
  migrateTelegramGroupChat: vi.fn(),
}));
vi.mock("@kaspa-actions/application", () => application);

const { deliverOutbox } = await import("./outbox.ts");

const facts = {
  amountKas: "50",
  closesAt: new Date("2026-11-09T18:00:00Z"),
  network: "MAINNET",
  participantCap: 32,
  participantCount: 3,
  phase: "open",
  publicId: "cmw5608th04eh01mp050ej458",
  title: "Community giveaway",
  verificationPaused: false,
  winnerAddress: null,
};

function fixture(event = "announce") {
  const row = {
    attempts: 0,
    id: "out1",
    kind: "group.giveaway",
    payload: { event, groupGiveawayId: "link1" },
  };
  const tx = {
    telegramOutbox: {
      findMany: vi.fn().mockResolvedValue([row]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    telegramGroupGiveaway: {
      findUnique: vi.fn().mockResolvedValue({
        giveawayId: "g1",
        group: { chatId: "-100555", removedAt: null },
      }),
    },
    telegramConnection: { updateMany: vi.fn() },
    telegramGiveawaySubscription: { updateMany: vi.fn() },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
  return {
    client: { sendMessage } as unknown as TelegramApiClient,
    db: db as unknown as PrismaClient,
    sendMessage,
    tx,
  };
}

const lastUpdate = (f: ReturnType<typeof fixture>) =>
  f.tx.telegramOutbox.updateMany.mock.calls.at(-1)?.[0];

describe("group giveaway posts", () => {
  beforeEach(() => {
    process.env.TOCCATA_LAB_ENABLED = "true";
    process.env.GIVEAWAY_LAB_ENABLED = "true";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
    application.loadGiveawayV6PublicFacts.mockReset().mockResolvedValue(facts);
    application.markTelegramGroupRemoved.mockReset();
    application.migrateTelegramGroupChat.mockReset();
  });

  it("posts the current state of the giveaway in the group", async () => {
    const f = fixture();
    await deliverOutbox(f.client, new Date(), f.db);
    expect(application.loadGiveawayV6PublicFacts).toHaveBeenCalledWith(f.db, { id: "g1" });
    expect(f.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "-100555",
        text: expect.stringContaining("3/32 spots taken"),
        buttons: [
          [
            {
              text: "Join giveaway",
              url: "https://example.test/giveaways/cmw5608th04eh01mp050ej458?from=tg-group",
            },
          ],
        ],
      }),
    );
    expect(lastUpdate(f)).toMatchObject({ data: { status: "SENT" } });
  });

  it("skips a post that no longer fits and groups the bot left", async () => {
    const f = fixture("result");
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.sendMessage).not.toHaveBeenCalled();
    expect(lastUpdate(f)).toMatchObject({
      data: { lastErrorCode: "STATE_CHANGED", status: "DEAD" },
    });

    const removed = fixture();
    removed.tx.telegramGroupGiveaway.findUnique.mockResolvedValue({
      giveawayId: "g1",
      group: { chatId: "-100555", removedAt: new Date() },
    });
    await deliverOutbox(removed.client, new Date(), removed.db);
    expect(removed.sendMessage).not.toHaveBeenCalled();
    expect(lastUpdate(removed)).toMatchObject({
      data: { lastErrorCode: "DELIVERY_NOT_AUTHORIZED", status: "DEAD" },
    });
  });

  it("retries later while chain verification is paused", async () => {
    application.loadGiveawayV6PublicFacts.mockResolvedValue({ ...facts, verificationPaused: true });
    const f = fixture();
    await deliverOutbox(f.client, new Date(), f.db);
    expect(f.sendMessage).not.toHaveBeenCalled();
    expect(lastUpdate(f)).toMatchObject({
      data: { attempts: 1, lastErrorCode: "DELIVERY_ERROR", status: "PENDING" },
    });
  });

  it("follows a group that became a supergroup and retries", async () => {
    const f = fixture();
    f.sendMessage.mockRejectedValue(
      new TelegramApiError("upgraded", true, 400, undefined, false, "-100999"),
    );
    await deliverOutbox(f.client, new Date(), f.db);
    expect(application.migrateTelegramGroupChat).toHaveBeenCalledWith(f.db, "-100555", "-100999");
    expect(lastUpdate(f)).toMatchObject({ data: { status: "PENDING" } });
  });

  it("stops posting in a group that removed the bot", async () => {
    const f = fixture();
    f.sendMessage.mockRejectedValue(new TelegramApiError("kicked", true, 403, undefined, true));
    await deliverOutbox(f.client, new Date(), f.db);
    expect(application.markTelegramGroupRemoved).toHaveBeenCalledWith(f.db, "-100555");
    expect(lastUpdate(f)).toMatchObject({ data: { status: "DEAD" } });
  });
});
