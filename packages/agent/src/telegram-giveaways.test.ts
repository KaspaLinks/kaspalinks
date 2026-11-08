import { describe, expect, it } from "vitest";
import {
  giveawayCardText,
  preparedGiveawayArticle,
  preparedV6GiveawayArticle,
  telegramGiveawayLinks,
  v6GiveawayShareText,
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

describe("V6 giveaway share cards", () => {
  const v6 = {
    publicId: "cmw6m0itx04jz01r32nhaa4g7",
    title: "Birthday giveaway $KAS",
    amountKas: "100",
    closesAt: new Date("2026-11-08T12:00:00Z"),
    participantCount: 12,
    participantCap: 32,
    phase: "open" as const,
  };

  it("shows the prize, free spots and UTC close of an open giveaway", () => {
    expect(v6GiveawayShareText(v6)).toBe(
      [
        "🎁 Birthday giveaway $KAS",
        "100 KAS · free entry · fair on-chain draw",
        "12/32 spots taken · entries close 2026-11-08 12:00 UTC",
      ].join("\n"),
    );
  });

  it("links to the giveaway page with URL buttons that work in groups", () => {
    const article = preparedV6GiveawayArticle(v6, "https://kaspalinks.com/some/path");
    const [[join], [own]] = article.reply_markup.inline_keyboard as [
      [{ text: string; url: string }],
      [{ text: string; url: string }],
    ];
    expect(join).toEqual({
      text: "Join giveaway",
      url: "https://kaspalinks.com/giveaways/cmw6m0itx04jz01r32nhaa4g7?from=telegram",
    });
    expect(own.url).toBe("https://kaspalinks.com/giveaway/new?from=telegram");
    expect(JSON.stringify(article)).not.toMatch(/web_app|callback_data|startapp/);
  });

  it("stops inviting entries once the giveaway is full or over", () => {
    const full = preparedV6GiveawayArticle({ ...v6, participantCount: 32 }, "https://k.test");
    expect(full.reply_markup.inline_keyboard[0]![0]!.text).toBe("View giveaway");
    expect(v6GiveawayShareText({ ...v6, participantCount: 32 })).toContain("All 32 spots taken");
    expect(v6GiveawayShareText({ ...v6, phase: "drawn" })).toContain("Winner drawn and paid");
  });

  it("shortens long titles and rejects injected IDs", () => {
    const text = v6GiveawayShareText({ ...v6, title: "x".repeat(200) });
    expect(text.split("\n")[0]).toBe(`🎁 ${"x".repeat(79)}…`);
    expect(() =>
      preparedV6GiveawayArticle({ ...v6, publicId: "../admin" }, "https://k.test"),
    ).toThrow();
  });
});
