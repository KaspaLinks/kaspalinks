import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateTelegramMiniAppInitData } from "./telegram-mini-app.ts";

const BOT_TOKEN = "123456:test-token";
const NOW = new Date("2026-08-31T15:00:00.000Z");

function signedInitData(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(NOW.getTime() / 1_000)),
    query_id: "query-1",
    user: JSON.stringify({ first_name: "Ada", id: 123456 }),
    ...overrides,
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

describe("validateTelegramMiniAppInitData", () => {
  it("returns the signed Telegram identity", () => {
    expect(validateTelegramMiniAppInitData(signedInitData(), BOT_TOKEN, { now: NOW })).toEqual({
      identity: { authDate: NOW, queryId: "query-1", userId: "123456" },
      ok: true,
    });
  });

  it("rejects tampered data", () => {
    const tampered = signedInitData().replace("123456", "999999");
    expect(validateTelegramMiniAppInitData(tampered, BOT_TOKEN, { now: NOW })).toEqual({
      error: "INVALID_SIGNATURE",
      ok: false,
    });
  });

  it("rejects stale and future authentication dates", () => {
    const old = signedInitData({
      auth_date: String(Math.floor(NOW.getTime() / 1_000) - 3_601),
    });
    const future = signedInitData({
      auth_date: String(Math.floor(NOW.getTime() / 1_000) + 61),
    });

    expect(validateTelegramMiniAppInitData(old, BOT_TOKEN, { now: NOW })).toEqual({
      error: "EXPIRED",
      ok: false,
    });
    expect(validateTelegramMiniAppInitData(future, BOT_TOKEN, { now: NOW })).toEqual({
      error: "EXPIRED",
      ok: false,
    });
  });

  it("rejects duplicate fields", () => {
    expect(
      validateTelegramMiniAppInitData(`${signedInitData()}&user=%7B%22id%22%3A1%7D`, BOT_TOKEN, {
        now: NOW,
      }),
    ).toEqual({ error: "MALFORMED", ok: false });
  });
});
