import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rate-limit";

const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  findGroup: vi.fn(),
  findLinks: vi.fn(),
  getChatMember: vi.fn(),
  link: vi.fn(),
  markRemoved: vi.fn(),
  requireCreator: vi.fn(),
}));

vi.mock("@kaspa-actions/agent", async () => ({
  ...(await vi.importActual<typeof import("@kaspa-actions/agent")>("@kaspa-actions/agent")),
  TelegramApiClient: class {
    getChatMember = mocks.getChatMember;
  },
}));
vi.mock("@kaspa-actions/application", () => ({
  ApplicationError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public status = 400,
    ) {
      super(message);
    }
  },
  linkGiveawayToTelegramGroup: mocks.link,
  markTelegramGroupRemoved: mocks.markRemoved,
  telegramGroupLinkState: (row: { postConfirmedAt: Date | null; postDeclinedAt: Date | null }) =>
    row.postConfirmedAt ? "confirmed" : row.postDeclinedAt ? "declined" : "pending",
}));
vi.mock("@kaspa-actions/db", () => ({
  AuditActorType: { CREATOR: "CREATOR" },
  prisma: {
    telegramGroup: { findUnique: mocks.findGroup },
    telegramGroupGiveaway: { findMany: mocks.findLinks },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/creator-guard", () => ({ requireCreator: mocks.requireCreator }));

import { ApplicationError } from "@kaspa-actions/application";
import { TelegramApiError } from "@kaspa-actions/agent";
import { GET, POST } from "./route";

function initData(userId = 77) {
  const values = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId }),
  });
  const secret = createHmac("sha256", "WebAppData").update("test-bot-token").digest();
  const check = [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  values.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return values.toString();
}

const publicId = "cmw5608th04eh01mp050ej458";
function request(method: "GET" | "POST", body?: unknown, data: null | string = initData()) {
  return new Request("https://example.test/api/telegram/groups/-1001234", {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(data ? { "x-telegram-mini-app-init-data": data } : {}),
    },
    method,
  });
}
const context = (chatId = "-1001234") => ({ params: Promise.resolve({ chatId }) });

describe("Telegram group giveaway links", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRateLimits();
    process.env.TOCCATA_LAB_ENABLED = "true";
    process.env.GIVEAWAY_LAB_ENABLED = "true";
    process.env.GIVEAWAY_V6_CREATION_ENABLED = "true";
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    mocks.requireCreator.mockResolvedValue({
      creator: { id: "creator-1" },
      ipHash: "ip",
      ok: true,
    });
    mocks.findGroup.mockResolvedValue({ chatId: "-1001234", removedAt: null, title: "Kaspa Fans" });
    mocks.getChatMember.mockResolvedValue({ status: "administrator" });
    mocks.findLinks.mockResolvedValue([
      { giveaway: { publicId }, postConfirmedAt: null, postDeclinedAt: null },
    ]);
    mocks.link.mockResolvedValue({ created: true, state: "pending", title: "Kaspa Fans" });
  });

  it("shows the group to its admin with their linked giveaways", async () => {
    const response = await GET(request("GET"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      group: { chatId: "-1001234", title: "Kaspa Fans" },
      links: [{ publicId, state: "pending" }],
    });
    expect(mocks.getChatMember).toHaveBeenCalledWith("-1001234", "77");
    expect(mocks.findLinks).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { giveaway: { creatorId: "creator-1" }, group: { chatId: "-1001234" } },
      }),
    );
  });

  it("links the caller's giveaway as the verified Telegram user", async () => {
    const response = await POST(request("POST", { publicId }), context());
    expect(response.status).toBe(200);
    expect(mocks.link).toHaveBeenCalledWith(expect.anything(), {
      chatId: "-1001234",
      creatorId: "creator-1",
      publicId,
      telegramUserId: "77",
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: "giveaway.telegram_group_linked" }),
    );
  });

  it("posts in the group only on the admin's choice", async () => {
    mocks.link.mockResolvedValue({ created: false, state: "confirmed", title: "Kaspa Fans" });
    const response = await POST(request("POST", { decision: "post", publicId }), context());
    expect(await response.json()).toEqual({
      group: { chatId: "-1001234", title: "Kaspa Fans" },
      state: "confirmed",
    });
    expect(mocks.link).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ decision: "post", telegramUserId: "77" }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: "giveaway.telegram_group_post" }),
    );
    expect((await POST(request("POST", { decision: "later", publicId }), context())).status).toBe(
      400,
    );
  });

  it("rejects missing identity, non-admins and private chat ids", async () => {
    expect((await GET(request("GET", undefined, null), context())).status).toBe(401);
    expect((await GET(request("GET"), context("12345"))).status).toBe(404);
    mocks.getChatMember.mockResolvedValue({ status: "member" });
    expect((await POST(request("POST", { publicId }), context())).status).toBe(403);
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("forgets a group that removed the bot", async () => {
    mocks.getChatMember.mockRejectedValue(
      new TelegramApiError("Forbidden: bot was kicked", true, 403, undefined, true),
    );
    expect((await GET(request("GET"), context())).status).toBe(404);
    expect(mocks.markRemoved).toHaveBeenCalledWith(expect.anything(), "-1001234");
  });

  it("passes on why a giveaway cannot be linked", async () => {
    mocks.link.mockRejectedValue(
      new ApplicationError("GIVEAWAY_CLOSING", "Entries close too soon.", 409),
    );
    const response = await POST(request("POST", { publicId }), context());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { message: "Entries close too soon." } });
  });
});
