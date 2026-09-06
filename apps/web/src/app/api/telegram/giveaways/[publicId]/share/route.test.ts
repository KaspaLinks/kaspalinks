import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/rate-limit";
const mocks = vi.hoisted(() => ({ card: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/telegram-giveaway", async () => ({
  ...(await vi.importActual<typeof import("@/lib/telegram-giveaway")>("@/lib/telegram-giveaway")),
  getTelegramGiveawayCard: mocks.card,
}));
vi.mock("@kaspa-actions/agent", async () => ({
  ...(await vi.importActual<typeof import("@kaspa-actions/agent")>("@kaspa-actions/agent")),
  TelegramApiClient: class {
    savePreparedInlineMessage = mocks.prepare;
  },
}));
import { POST } from "./route";
function initData(userId = 123, authDate = Math.floor(Date.now() / 1000)) {
  const values = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: userId }),
  });
  const secret = createHmac("sha256", "WebAppData").update("test-bot-token").digest();
  const check = [...values]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  values.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return values.toString();
}
function req(data?: string) {
  return new Request("https://example.test/api/telegram/giveaways/g1/share", {
    method: "POST",
    headers: data ? { "x-telegram-mini-app-init-data": data } : {},
  });
}
const context = { params: Promise.resolve({ publicId: "g1" }) };
describe("Public Telegram prepared giveaway cards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRateLimits();
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    process.env.TELEGRAM_BOT_USERNAME = "kaspa_bot";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test";
    mocks.card.mockResolvedValue({
      publicId: "g1",
      title: "Weekend",
      creator: "alice",
      amountKas: "10",
      closesAt: new Date(),
      status: "OPEN",
      fundingConfirmed: true,
    });
    mocks.prepare.mockResolvedValue({ id: "prepared1", expiration_date: 1234 });
  });
  it("prepares only for the signed participant ID without Creator access", async () => {
    const response = await POST(req(initData()), context);
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ type: "article", id: "g1" }),
    );
    expect(await response.json()).toEqual({ id: "prepared1", expiresAt: 1234 });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects unsigned, tampered and expired identity before reading a card", async () => {
    for (const data of [undefined, initData().replace("123", "456"), initData(123, 1)])
      expect((await POST(req(data), context)).status).toBe(401);
    expect(mocks.card).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("rejects missing giveaways and invalid public IDs", async () => {
    mocks.card.mockResolvedValue(null);
    expect((await POST(req(initData()), context)).status).toBe(404);
    expect(
      (await POST(req(initData()), { params: Promise.resolve({ publicId: "../secret" }) })).status,
    ).toBe(404);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
