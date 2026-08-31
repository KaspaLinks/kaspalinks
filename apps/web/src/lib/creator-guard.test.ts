import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { requireCreator } from "./creator-guard";

const mocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));

vi.mock("./audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

const BOT_TOKEN = "123456:test-token";

function signedInitData(userId: string, now = new Date()): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(now.getTime() / 1_000)),
    query_id: "query-1",
    user: JSON.stringify({ id: Number(userId) }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

describe("requireCreator Telegram Mini App scope", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("resolves the connected beta creator when the scope is explicitly allowed", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
    const creator = { id: "creator-1", telegramBetaEnabled: true, username: "example" };
    const prisma = {
      telegramConnection: {
        findUnique: vi.fn().mockResolvedValue({ creator, creatorId: creator.id }),
      },
    };
    const request = new Request("https://kaspalinks.test/api/toccata-lab/giveaways", {
      headers: { "x-telegram-mini-app-init-data": signedInitData("123") },
    });

    const result = await requireCreator(request, prisma as never, {
      allowTelegramMiniApp: true,
    });

    expect(result).toEqual(expect.objectContaining({ creator, ok: true }));
    expect(prisma.telegramConnection.findUnique).toHaveBeenCalledWith({
      include: { creator: true },
      where: { telegramUserId: "123" },
    });
  });

  it("does not accept Mini App identity outside explicitly enabled routes", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
    const request = new Request("https://kaspalinks.test/api/creator/actions", {
      headers: { "x-telegram-mini-app-init-data": signedInitData("123") },
    });

    const result = await requireCreator(request, {} as never);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects an unconnected Telegram identity", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", BOT_TOKEN);
    const prisma = {
      telegramConnection: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const request = new Request("https://kaspalinks.test/api/toccata-lab/giveaways", {
      headers: { "x-telegram-mini-app-init-data": signedInitData("999") },
    });

    const result = await requireCreator(request, prisma as never, {
      allowTelegramMiniApp: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });
});
