import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCard: vi.fn(),
  giveawayList: vi.fn(),
  subscribe: vi.fn(),
  stopSubscriptions: vi.fn(),
  answerCallbackQuery: vi.fn(),
  createAction: vi.fn(),
  createGiveawaySetupDraft: vi.fn(),
  updateSettings: vi.fn(),
  ensureWorkspace: vi.fn(),
  createUpdate: vi.fn(),
  consumeTelegramConnectCode: vi.fn(),
  findConnection: vi.fn(),
  touchConnection: vi.fn(),
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
  ApplicationError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
  consumeTelegramConnectCodeTool: mocks.consumeTelegramConnectCode,
  createActionTool: mocks.createAction,
  updateAgentSettingsTool: mocks.updateSettings,
  createGiveawaySetupDraftTool: mocks.createGiveawaySetupDraft,
  ensureTelegramGiveawayWorkspaceTool: mocks.ensureWorkspace,
  setGiveawayResultSubscription: mocks.subscribe,
  stopGiveawayResultSubscriptions: mocks.stopSubscriptions,
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
      giveaway: { findMany: mocks.giveawayList },
      telegramConnection: { findUnique: mocks.findConnection, updateMany: mocks.touchConnection },
      telegramUpdate: {
        create: mocks.createUpdate,
        update: mocks.updateUpdate,
        updateMany: mocks.updateMany,
      },
    },
  };
});

import { Prisma } from "@kaspa-actions/db";

vi.mock("@/lib/telegram-giveaway", () => ({ getTelegramGiveawayCard: mocks.getCard }));
import { resetRateLimits } from "@/lib/rate-limit";
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
    process.env.GIVEAWAY_V6_CREATION_ENABLED = "false";
    resetRateLimits();
    process.env.TOCCATA_LAB_ENABLED = "true";
    process.env.GIVEAWAY_LAB_ENABLED = "true";
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

  it("opens an account-free Telegram workspace for a new chat's /help", async () => {
    mocks.findConnection.mockResolvedValue(null);
    mocks.ensureWorkspace.mockResolvedValue({
      connection: { creatorId: "creator-tg", telegramChatId: "123", telegramUserId: "123" },
      created: true,
      creator: {
        accountKind: "TELEGRAM_ONLY",
        prizeCovenantEnabled: true,
        telegramBetaEnabled: true,
      },
    });

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
    // Usage stats: a fixed label, never the text, and the chat's last activity.
    expect(mocks.createUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({ label: "/help", updateId: "20" }),
    });
    expect(mocks.touchConnection).toHaveBeenCalledWith({
      data: { lastActiveAt: expect.any(Date) },
      where: { telegramUserId: "123" },
    });
    expect(mocks.ensureWorkspace).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("/claim <KAS> [title]"),
      }),
    );
  });

  it("opens the claim link Mini App for anyone and keeps the link in this chat's workspace", async () => {
    mocks.findConnection.mockResolvedValue(null);

    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123 },
          message_id: 2,
          text: "/claim 5 Coffee for Ada",
        },
        update_id: 21,
      }),
    );

    expect(response.status).toBe(200);
    const sent = mocks.sendMessage.mock.calls[0]![0] as {
      buttons: Array<Array<{ text: string; web_app?: { url: string } }>>;
      text: string;
    };
    expect(sent.text).toContain("5 KAS · Coffee for Ada");
    const url = new URL(sent.buttons[0]![0]!.web_app!.url);
    expect(url.pathname).toBe("/telegram");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      amount: "5",
      mode: "claim",
      title: "Coffee for Ada",
      utm_source: "telegram-bot",
    });
    expect(mocks.ensureWorkspace).toHaveBeenCalledWith(expect.anything(), {
      telegramChatId: "123",
      telegramUserId: "123",
    });
  });

  it("says when claim links are switched off", async () => {
    vi.stubEnv("CLAIMABLE_ANONYMOUS_ENABLED", "false");
    try {
      await POST(
        webhookRequest({
          message: {
            chat: { id: 123, type: "private" },
            from: { id: 123 },
            message_id: 2,
            text: "/claim 5",
          },
          update_id: 22,
        }),
      );
      expect(mocks.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("temporarily unavailable") }),
      );
    } finally {
      vi.unstubAllEnvs();
    }
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

  it("keeps the command overview on /start for accounts without the Mini App", async () => {
    mocks.findConnection.mockResolvedValue({
      creator: { defaultRecipientAddress: null },
      creatorId: "creator-1",
      telegramChatId: "123",
      telegramUserId: "123",
    });

    await POST(
      webhookRequest({
        message: {
          chat: { id: 123, type: "private" },
          from: { id: 123 },
          message_id: 5,
          text: "/start",
        },
        update_id: 24,
      }),
    );

    expect(mocks.sendMessage.mock.calls[0]?.[0]?.text).toContain(
      "Amounts are always entered in KAS",
    );
  });

  it("explains command units and the fixed draw times in help", async () => {
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
    expect(help).toContain("SilverScript Mini App");
    expect(help).toContain("00:00, 06:00, 12:00 or 18:00 UTC");
    expect(help).toContain("Example: /giveaway 0.5 Weekend KAS");
    expect(help).not.toContain("<duration>");
    expect(help).not.toContain("7d");
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

  it("never falls back to legacy giveaway creation for accounts without SilverScript access", async () => {
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
          text: "/giveaway 0,5 Weekend KAS",
        },
        update_id: 4,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createGiveawaySetupDraft).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("not enabled") }),
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
  it("opens a public giveaway without a creator connection or implicit subscription", async () => {
    mocks.getCard.mockResolvedValue({
      publicId: "g1",
      title: "Weekend",
      creator: "alice",
      amountKas: "10",
      closesAt: new Date(),
      status: "OPEN",
      fundingConfirmed: true,
    });
    const response = await POST(
      webhookRequest({
        update_id: 101,
        message: {
          message_id: 1,
          from: { id: 123 },
          chat: { id: 123, type: "private" },
          text: "/start g_g1",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.findConnection).not.toHaveBeenCalled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    expect(mocks.sendMessage.mock.calls[0][0].buttons[1][0].callback_data).toBe("watch:on:g1");
  });
  it("enables a result reminder only after an explicit private callback", async () => {
    mocks.subscribe.mockResolvedValue({ title: "Weekend", enabled: true });
    const response = await POST(
      webhookRequest({
        update_id: 102,
        callback_query: {
          id: "cb",
          from: { id: 123 },
          data: "watch:on:g1",
          message: { message_id: 1, chat: { id: 123, type: "private" } },
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.subscribe).toHaveBeenCalledWith(expect.anything(), {
      publicId: "g1",
      telegramUserId: "123",
      telegramChatId: "123",
      enabled: true,
    });
    expect(mocks.findConnection).not.toHaveBeenCalled();
  });
  it("does not subscribe group callbacks", async () => {
    await POST(
      webhookRequest({
        update_id: 103,
        callback_query: {
          id: "cb",
          from: { id: 123 },
          data: "watch:on:g1",
          message: { message_id: 1, chat: { id: -123, type: "group" } },
        },
      }),
    );
    expect(mocks.subscribe).not.toHaveBeenCalled();
  });
  it("accepts stop without a Creator account", async () => {
    await POST(
      webhookRequest({
        update_id: 104,
        message: {
          message_id: 1,
          from: { id: 123 },
          chat: { id: 123, type: "private" },
          text: "/stop",
        },
      }),
    );
    expect(mocks.stopSubscriptions).toHaveBeenCalledWith(expect.anything(), "123");
  });
  it("lets a blocked same-chat connection consume a fresh reconnect code", async () => {
    mocks.findConnection.mockResolvedValue({ telegramChatId: "123", blockedAt: new Date() });
    mocks.consumeTelegramConnectCode.mockResolvedValue({ creator: { username: "alice" } });
    await POST(
      webhookRequest({
        update_id: 105,
        message: {
          message_id: 1,
          from: { id: 123 },
          chat: { id: 123, type: "private" },
          text: "/connect new-code",
        },
      }),
    );
    expect(mocks.consumeTelegramConnectCode).toHaveBeenCalled();
  });
  it("rejects malformed nested update fields before claiming the update", async () => {
    const response = await POST(webhookRequest({ update_id: 106, message: { chat: null } }));
    expect(response.status).toBe(400);
    expect(mocks.createUpdate).not.toHaveBeenCalled();
  });
});

describe("SilverScript bot handoff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRateLimits();
    process.env.TOCCATA_LAB_ENABLED = "true";
    process.env.GIVEAWAY_LAB_ENABLED = "true";
    process.env.GIVEAWAY_V6_CREATION_ENABLED = "true";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret";
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.NEXT_PUBLIC_APP_URL = "https://kaspalinks.com";
    mocks.createUpdate.mockResolvedValue({});
    mocks.updateUpdate.mockResolvedValue({});
    mocks.sendMessage.mockResolvedValue({ message_id: 1 });
    mocks.ensureWorkspace.mockResolvedValue({
      connection: {
        creatorId: "creator-tg",
        telegramChatId: "123",
        telegramUserId: "123",
      },
      created: true,
      creator: {
        accountKind: "TELEGRAM_ONLY",
        id: "creator-tg",
        prizeCovenantEnabled: true,
        telegramBetaEnabled: true,
      },
    });
    mocks.findConnection.mockResolvedValue({
      creatorId: "creator-1",
      telegramUserId: "123",
      telegramChatId: "123",
      creator: { prizeCovenantEnabled: true, telegramBetaEnabled: true },
    });
    mocks.giveawayList.mockResolvedValue([
      {
        publicId: "giveaway-id",
        title: "Silver giveaway",
        v6Projection: { observedRegistrationCount: 3, phase: "OPEN" },
      },
    ]);
  });
  const request = (text: string) =>
    webhookRequest({
      update_id: 989,
      message: { chat: { id: 123, type: "private" }, from: { id: 123 }, message_id: 1, text },
    });
  it("keeps complete help for SilverScript-enabled accounts", async () => {
    expect((await POST(request("/help"))).status).toBe(200);
    const sent = mocks.sendMessage.mock.calls[0][0];
    for (const command of [
      "/link",
      "/invoice",
      "/tip",
      "/donation",
      "/goal",
      "/links",
      "/payments",
      "/stats",
      "/giveaways",
      "/disconnect",
    ])
      expect(sent.text).toContain(command);
    expect(sent.text).toContain("set up → choose return wallet → fund → share");
    expect(JSON.stringify(sent.buttons)).toContain("/telegram?mode=create");
    expect(JSON.stringify(sent.buttons)).not.toContain("/toccata-lab/giveaway");
  });
  it("opens SilverScript without creating a legacy draft", async () => {
    expect((await POST(request("/giveaway 0.5 Test"))).status).toBe(200);
    expect(mocks.createGiveawaySetupDraft).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.sendMessage.mock.calls)).not.toContain("Older giveaways");
    expect(JSON.stringify(mocks.sendMessage.mock.calls)).not.toContain("/toccata-lab/giveaway");
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: expect.arrayContaining([
          [
            {
              text: "Review giveaway",
              web_app: {
                url: "https://kaspalinks.com/telegram?mode=create&prize=0.5&title=Test",
              },
            },
          ],
        ]),
      }),
    );
  });
  it("creates a Telegram-only workspace before opening SilverScript", async () => {
    mocks.findConnection.mockResolvedValue(null);

    expect((await POST(request("/giveaway 0.5 Test"))).status).toBe(200);

    expect(mocks.ensureWorkspace).toHaveBeenCalledWith(expect.anything(), {
      telegramChatId: "123",
      telegramUserId: "123",
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: expect.arrayContaining([
          [
            {
              text: "Review giveaway",
              web_app: {
                url: "https://kaspalinks.com/telegram?mode=create&prize=0.5&title=Test",
              },
            },
          ],
        ]),
      }),
    );
  });
  function telegramOnly(defaultRecipientAddress: null | string = null) {
    mocks.findConnection.mockResolvedValue({
      creatorId: "creator-tg",
      notificationsEnabled: false,
      telegramUserId: "123",
      telegramChatId: "123",
      creator: {
        accountKind: "TELEGRAM_ONLY",
        defaultRecipientAddress,
        prizeCovenantEnabled: true,
        telegramBetaEnabled: true,
        username: "tg_0123456789abcdef01234567",
      },
    });
  }

  it("asks a Telegram-only workspace for its wallet before a payment link", async () => {
    telegramOnly();

    expect((await POST(request("/tip Coffee"))).status).toBe(200);

    expect(mocks.createAction).not.toHaveBeenCalled();
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Set the wallet that receives payments first: /wallet kaspa:…",
      }),
    );
  });

  it("saves the wallet from /wallet", async () => {
    telegramOnly();
    mocks.updateSettings.mockResolvedValue({});
    const address = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

    expect((await POST(request(`/wallet ${address}`))).status).toBe(200);

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.anything(),
      { channel: "telegram", creatorId: "creator-tg" },
      { defaultRecipientAddress: address },
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("Wallet saved") }),
    );
  });

  it("creates an account-free payment link with a /a/ address for a Telegram-only workspace", async () => {
    const address = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";
    telegramOnly(address);
    mocks.createAction.mockResolvedValue({
      publicId: "pub123",
      slug: "coffee",
      title: "Coffee",
    });

    expect((await POST(request("/tip 2 Coffee"))).status).toBe(200);

    expect(mocks.createAction).toHaveBeenCalledWith(
      expect.anything(),
      { channel: "telegram", creatorId: "creator-tg" },
      expect.objectContaining({
        amountKas: "2",
        hiddenFromProfile: true,
        recipientAddress: address,
        type: "kaspa.tip",
      }),
      expect.objectContaining({ accountFree: { source: "telegram-bot" } }),
    );
    const sent = mocks.sendMessage.mock.calls[0]![0];
    expect(sent.text).toBe("Created: Coffee\nhttps://kaspalinks.com/a/pub123");
    expect(JSON.stringify(sent.buttons)).toContain("Enable payment alerts");
  });

  it("shows the account-free command set for a Telegram-only workspace", async () => {
    mocks.findConnection.mockResolvedValue({
      creatorId: "creator-tg",
      telegramUserId: "123",
      telegramChatId: "123",
      creator: {
        accountKind: "TELEGRAM_ONLY",
        prizeCovenantEnabled: true,
        telegramBetaEnabled: true,
      },
    });

    expect((await POST(request("/help"))).status).toBe(200);
    const sent = mocks.sendMessage.mock.calls[0][0];
    expect(sent.text).toContain("No KaspaLinks account needed");
    expect(sent.text).toContain("/claim <KAS> [title]");
    expect(sent.text).toContain("/wallet kaspa:");
    expect(sent.text).not.toContain("/disconnect");
    expect(JSON.stringify(sent.buttons)).toContain("Create giveaway");
  });
  it("greets /start with four Mini App buttons instead of command syntax", async () => {
    mocks.findConnection.mockResolvedValue({
      creatorId: "creator-tg",
      telegramUserId: "123",
      telegramChatId: "123",
      creator: {
        accountKind: "TELEGRAM_ONLY",
        prizeCovenantEnabled: true,
        telegramBetaEnabled: true,
      },
    });

    expect((await POST(request("/start"))).status).toBe(200);
    const sent = mocks.sendMessage.mock.calls[0]![0] as {
      buttons: Array<Array<{ text: string; web_app: { url: string } }>>;
      text: string;
    };
    expect(sent.text).toContain("No account needed");
    expect(sent.text).not.toContain("/tip");
    const buttons = sent.buttons.flat().map((button) => {
      const url = new URL(button.web_app.url);
      return [button.text, `${url.pathname}?mode=${url.searchParams.get("mode")}`];
    });
    expect(buttons).toEqual([
      ["Send KAS", "/telegram?mode=claim"],
      ["Get paid", "/telegram?mode=pay"],
      ["Giveaway", "/telegram?mode=create"],
      ["My links", "/telegram?mode=mine"],
    ]);
  });

  it("lists only the connected creator covenant giveaways and opens management", async () => {
    expect((await POST(request("/giveaways"))).status).toBe(200);
    expect(mocks.giveawayList).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          creatorId: "creator-1",
          drawProtocolVersion: 6,
          v6Bootstrap: { isNot: null },
        },
      }),
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("/giveaways/giveaway-id"),
        buttons: expect.arrayContaining([
          [
            {
              text: "Manage giveaways",
              web_app: { url: "https://kaspalinks.com/telegram?mode=manage" },
            },
          ],
        ]),
      }),
    );
  });
});
