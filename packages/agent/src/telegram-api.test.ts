import { describe, expect, it, vi } from "vitest";

import { TelegramApiClient } from "./telegram-api.ts";

describe("TelegramApiClient", () => {
  it("registers the visible bot command menu", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = new TelegramApiClient("test-token", fetcher);

    await expect(
      client.setMyCommands([{ command: "help", description: "Show all commands" }]),
    ).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/setMyCommands",
      expect.objectContaining({
        body: JSON.stringify({
          commands: [{ command: "help", description: "Show all commands" }],
        }),
        method: "POST",
      }),
    );
  });

  it("sends Mini App buttons using Telegram web_app markup", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = new TelegramApiClient("test-token", fetcher);

    await client.sendMessage({
      buttons: [
        [
          {
            text: "Finish giveaway setup",
            web_app: { url: "https://example.test/toccata-lab/giveaway?draft=draft-1" },
          },
        ],
      ],
      chatId: "123",
      text: "Draft ready",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({
        body: JSON.stringify({
          chat_id: "123",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "Finish giveaway setup",
                  web_app: { url: "https://example.test/toccata-lab/giveaway?draft=draft-1" },
                },
              ],
            ],
          },
          text: "Draft ready",
        }),
        method: "POST",
      }),
    );
  });
});

describe("Telegram delivery errors and prepared cards", () => {
  it("retains flood-control retry_after without disabling a chat", async () => {
    const client = new TelegramApiClient(
      "test-token",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 120 } }),
            { status: 429 },
          ),
        ),
    );
    await expect(client.sendMessage({ chatId: "123", text: "Test" })).rejects.toMatchObject({
      permanent: false,
      connectionUnavailable: false,
      retryAfterSeconds: 120,
    });
  });
  it("distinguishes invalid message content from blocked chats", async () => {
    for (const code of [400, 403]) {
      const client = new TelegramApiClient(
        "test-token",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ ok: false, error_code: code }), { status: code }),
          ),
      );
      await expect(client.sendMessage({ chatId: "123", text: "Test" })).rejects.toMatchObject({
        permanent: true,
        connectionUnavailable: code === 403,
      });
    }
  });
  it("binds prepared cards to the authenticated user and only prepares them", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, result: { id: "prepared", expiration_date: 1234 } }),
        ),
      );
    const client = new TelegramApiClient("test-token", fetcher);
    await client.savePreparedInlineMessage("123", { type: "article", id: "public" });
    expect(fetcher.mock.calls[0]![0]).toContain("savePreparedInlineMessage");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body).user_id).toBe("123");
  });
});
