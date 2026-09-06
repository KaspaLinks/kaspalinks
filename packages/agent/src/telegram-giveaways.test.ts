import { describe, expect, it } from "vitest";
import {
  giveawayCardText,
  preparedGiveawayArticle,
  telegramGiveawayLinks,
} from "./telegram-giveaways.ts";
import { parseTelegramCommand } from "./telegram-commands.ts";
const card = {
  publicId: "giveaway-1",
  title: "Weekend",
  creator: "alice",
  amountKas: "10.5",
  closesAt: new Date("2026-09-07T12:00:00Z"),
  status: "OPEN",
  fundingConfirmed: true,
};
describe("Telegram giveaway cards", () => {
  it("includes the public prize, creator, funding and UTC deadline", () => {
    expect(giveawayCardText(card)).toContain("10.5 KAS · by alice");
    expect(giveawayCardText(card)).toContain("2026-09-07 12:00 UTC");
    expect(giveawayCardText({ ...card, fundingConfirmed: false })).toContain("not confirmed");
  });
  it("uses public IDs and URL buttons that can be shared to groups", () => {
    const result = preparedGiveawayArticle(card, "https://example.test", "kaspa_bot");
    expect(result.reply_markup.inline_keyboard[0]![0]!.url).toBe(
      "https://t.me/kaspa_bot?startapp=g_giveaway-1",
    );
    expect(JSON.stringify(result)).not.toMatch(/web_app|callback_data|claimCode|refundCode|seed/i);
  });
  it("rejects injected IDs and bot usernames", () => {
    expect(() =>
      telegramGiveawayLinks("https://example.test", "kaspa_bot", "../secrets#claim"),
    ).toThrow();
    expect(() => telegramGiveawayLinks("https://example.test", "bad/bot", "giveaway-1")).toThrow();
  });
  it("keeps public starts separate from creator connection codes", () => {
    expect(parseTelegramCommand("/start g_giveaway-1")).toEqual({
      kind: "public_giveaway",
      publicId: "giveaway-1",
    });
    expect(parseTelegramCommand("/start watch_giveaway-1")).toEqual({
      kind: "watch_giveaway",
      publicId: "giveaway-1",
    });
    expect(parseTelegramCommand("/start connection-code")).toEqual({
      kind: "connect",
      code: "connection-code",
    });
    expect(parseTelegramCommand("/stop")).toEqual({ kind: "stop_giveaway_alerts" });
  });
});
