import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAction: vi.fn(),
  requireCreator: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@kaspa-actions/db", () => ({ prisma: {} }));
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
  createActionTool: mocks.createAction,
  updateAgentSettingsTool: mocks.updateSettings,
}));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.requireCreator }));
vi.mock("@/lib/rate-limit-helpers", () => ({
  enforceRateLimit: () => ({ allowed: true }),
  RateBuckets: { CREATOR_ACTION_CREATE: "creator.action-create" },
}));

import { ApplicationError } from "@kaspa-actions/application";

import { POST } from "./route";

const WALLET = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

function telegramCreator(overrides: Record<string, unknown> = {}) {
  return {
    accountKind: "TELEGRAM_ONLY",
    defaultRecipientAddress: null,
    id: "creator-tg",
    username: "tg_123",
    ...overrides,
  };
}

function post(body: unknown) {
  return POST(
    new Request("https://kaspalinks.com/api/telegram/payment-links", {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-telegram-mini-app-init-data": "x" },
      method: "POST",
    }),
  );
}

describe("POST /api/telegram/payment-links", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = "https://kaspalinks.com";
    mocks.requireCreator.mockResolvedValue({
      creator: telegramCreator(),
      ipHash: "ip-hash",
      ok: true,
    });
    mocks.createAction.mockImplementation(async (_prisma, _actor, input: { title: string }) => ({
      publicId: "pub123",
      slug: null,
      title: input.title,
    }));
  });

  it("saves the wallet once and creates an unlisted link with an /a/ address", async () => {
    const response = await post({
      amountKas: "2,5",
      title: "Coffee",
      type: "kaspa.tip",
      walletAddress: WALLET,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      action: { publicId: "pub123", title: "Coffee", url: "https://kaspalinks.com/a/pub123" },
      wallet: WALLET,
    });
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      {},
      { channel: "telegram", creatorId: "creator-tg" },
      { defaultRecipientAddress: WALLET },
    );
    expect(mocks.createAction).toHaveBeenCalledWith(
      {},
      { channel: "telegram", creatorId: "creator-tg" },
      expect.objectContaining({
        amountKas: "2.5",
        hiddenFromProfile: true,
        recipientAddress: WALLET,
        type: "kaspa.tip",
      }),
      { accountFree: { source: "telegram-bot" }, ipHash: "ip-hash" },
    );
  });

  it("uses the saved wallet without writing it again and sends a goal as target", async () => {
    mocks.requireCreator.mockResolvedValue({
      creator: telegramCreator({ defaultRecipientAddress: WALLET }),
      ipHash: "ip-hash",
      ok: true,
    });

    await post({
      amountKas: "100",
      title: "Microphone",
      type: "kaspa.goal",
      walletAddress: WALLET,
    });

    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.createAction).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ goalKas: "100" }),
      expect.anything(),
    );
  });

  it("turns payment alerts on only when the form asks for it", async () => {
    mocks.requireCreator.mockResolvedValue({
      creator: telegramCreator({ defaultRecipientAddress: WALLET }),
      ipHash: "ip-hash",
      ok: true,
    });

    await post({ alerts: true, title: "Coffee", type: "kaspa.tip" });

    expect(mocks.updateSettings).toHaveBeenCalledWith({}, expect.anything(), {
      notificationsEnabled: true,
    });
  });

  it("asks for a wallet before the first link", async () => {
    const response = await post({ title: "Coffee", type: "kaspa.tip" });

    expect(response.status).toBe(400);
    expect(mocks.createAction).not.toHaveBeenCalled();
  });

  it("rejects unknown link types and extra fields", async () => {
    expect((await post({ title: "x", type: "kaspa.giveaway", walletAddress: WALLET })).status).toBe(
      400,
    );
    expect((await post({ recipientAddress: WALLET, title: "x", type: "kaspa.tip" })).status).toBe(
      400,
    );
    expect(mocks.createAction).not.toHaveBeenCalled();
  });

  it("passes validation errors from link creation to the form", async () => {
    mocks.createAction.mockRejectedValue(
      new ApplicationError("INVALID_AMOUNT", "Amount must be at least 0.2 KAS.", 400),
    );

    const response = await post({
      amountKas: "0.01",
      title: "Coffee",
      type: "kaspa.invoice",
      walletAddress: WALLET,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("Amount must be at least 0.2 KAS.");
  });

  it("refuses requests without Telegram authorization", async () => {
    mocks.requireCreator.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });

    expect((await post({ title: "Coffee", type: "kaspa.tip" })).status).toBe(401);
    expect(mocks.createAction).not.toHaveBeenCalled();
  });
});
