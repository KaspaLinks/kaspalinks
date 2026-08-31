import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  answerCallbackQuery: vi.fn(),
  createGiveawaySetupDraft: vi.fn(),
  createUpdate: vi.fn(),
  consumeTelegramConnectCode: vi.fn(),
  findConnection: vi.fn(),
  sendMessage: vi.fn(),
  updateMany: vi.fn(),
  updateUpdate: vi.fn(),
}));

vi.mock("@kaspa-actions/agent", async () => {
  const actual =
    await vi.importActual<typeof import("@kaspa-actions/agent")>("@kaspa-actions/agent");
  return {
    ...actual,
    TelegramApiClient: class {
      answerCallbackQuery = mocks.answerCallbackQuery;
      sendMessage = mocks.sendMessage;
    },
  };
});

vi.mock("@kaspa-actions/application", () => ({
  actorContext: (creatorId: string, channel: string) => ({ channel, creatorId }),
  ApplicationError: class extends Error {},
  consumeTelegramConnectCodeTool: mocks.consumeTelegramConnectCode,
  createGiveawaySetupDraftTool: mocks.createGiveawaySetupDraft,
}));

vi.mock("@kaspa-actions/db", () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, options: { code: string }) {
      super(message);
      this.code = options.code;
    }
  }
  return {
    Prisma: { PrismaClientKnownRequestError },
    prisma: {
      telegramConnection: { findUnique: mocks.findConnection },
      telegramUpdate: {
        create: mocks.createUpdate,
        update: mocks.updateUpdate,
        updateMany: mocks.updateMany,
      },
    },
  };
});

import { Prisma } from "@kaspa-actions/db";

import { POST } from "./route";

function webhookRequest(body: unknown, secret = "webhook-secret") {
  return new Request("https://kaspalinks.com/api/agent/telegram/webhook", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
    },
    method: "POST",
  });
}

describe("Telegram Agent webhook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://kaspalinks.com";
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret";
    mocks.createUpdate.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.updateUpdate.mockResolvedValue({});
    mocks.sendMessage.mockResolvedValue({ message_id: 1 });
    mocks.createGiveawaySetupDraft.mockResolvedValue({ id: "giveaway-draft-1" });
  });

  it("hides the endpoint when Telegram's secret header is wrong", async () => {
    const response = await POST(webhookRequest({ update_id: 1 }, "wrong-secret"));

    expect(response.status).toBe(404);
    expect(mocks.createUpdate).not.toHaveBeenCalled();
  });

  it("accepts but ignores messages outside private chats", async () => {
    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: -100, type: "group" },
          from: { id: 123 },
          message_id: 1,
          text: "/help",
        },
        update_id: 2,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.updateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processedAt: expect.any(Date) }) }),
    );
  });

  it("explains how an unconnected private chat completes the connection", async () => {
    mocks.findConnection.mockResolvedValue(null);

    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123 },
          message_id: 2,
          text: "/help",
        },
        update_id: 20,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("send /connect followed by that code"),
      }),
    );
  });

  it("does not reuse a connection code when the private chat is already connected", async () => {
    mocks.findConnection.mockResolvedValue({
      creator: { username: "example" },
      creatorId: "creator-1",
      telegramChatId: "123",
      telegramUserId: "123",
    });

    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123 },
          message_id: 3,
          text: "/connect already-used-code",
        },
        update_id: 21,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.consumeTelegramConnectCode).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Already connected") }),
    );
  });

  it("explains command units and duration syntax in help", async () => {
    mocks.findConnection.mockResolvedValue({
      creator: { defaultRecipientAddress: null },
      creatorId: "creator-1",
      telegramChatId: "123",
      telegramUserId: "123",
    });

    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123 },
          message_id: 5,
          text: "/help",
        },
        update_id: 23,
      }),
    );

    expect(response.status).toBe(200);
    const help = mocks.sendMessage.mock.calls[0]?.[0]?.text as string;
    expect(help).toContain("Amounts are always entered in KAS");
    expect(help).toContain("30m");
    expect(help).toContain("24h");
    expect(help).toContain("7d");
  });

  it("acknowledges invalid commands after sending the correction", async () => {
    mocks.findConnection.mockResolvedValue({
      creator: { defaultRecipientAddress: null },
      creatorId: "creator-1",
      telegramChatId: "123",
      telegramUserId: "123",
    });

    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123 },
          message_id: 4,
          text: "/invoice 10",
        },
        update_id: 22,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("title") }),
    );
    expect(mocks.updateUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ processedAt: expect.any(Date) }) }),
    );
  });

  it("deduplicates replayed update ids before a second Telegram response", async () => {
    mocks.findConnection.mockResolvedValue({
      creator: { defaultRecipientAddress: null },
      creatorId: "creator-1",
      telegramChatId: "123",
      telegramUserId: "123",
    });
    const payload = {
      message: {
        chat: { id: 123, type: "private" },
        from: { id: 123 },
        message_id: 1,
        text: "/help",
      },
      update_id: 3,
    };

    expect((await POST(webhookRequest(payload))).status).toBe(200);
    mocks.createUpdate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        clientVersion: "test",
        code: "P2002",
      }),
    );
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await POST(webhookRequest(payload))).status).toBe(200);

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("creates only a browser handoff draft for a giveaway command", async () => {
    mocks.findConnection.mockResolvedValue({
      creator: { defaultRecipientAddress: null },
      creatorId: "creator-1",
      telegramChatId: "123",
      telegramUserId: "123",
    });

    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123 },
          message_id: 2,
          text: "/giveaway 10,5 24h Weekend KAS",
        },
        update_id: 4,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createGiveawaySetupDraft).toHaveBeenCalledWith(
      expect.anything(),
      { channel: "telegram", creatorId: "creator-1" },
      "123",
      {
        amountKas: "10.5",
        entryWindowSeconds: 86_400,
        title: "Weekend KAS",
        winnerClaimWindowSeconds: 86_400,
      },
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: [
          [
            {
              text: "Finish giveaway setup",
              url: "https://kaspalinks.com/toccata-lab/giveaway?draft=giveaway-draft-1",
            },
          ],
        ],
        text: expect.stringContaining("never enter Telegram"),
      }),
    );
  });

  it("rejects callbacks whose Telegram user does not own the connected chat", async () => {
    mocks.findConnection.mockResolvedValue({
      creator: {},
      creatorId: "creator-1",
      telegramChatId: "999",
      telegramUserId: "123",
    });

    const response = await POST(
      webhookRequest({
        callback_query: {
          data: "menu:links",
          from: { id: 123 },
          id: "callback-1",
          message: { chat: { id: 123, type: "private" }, message_id: 3 },
        },
        update_id: 5,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.answerCallbackQuery).toHaveBeenCalledWith(
      "callback-1",
      "Connect this private chat first.",
    );
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
