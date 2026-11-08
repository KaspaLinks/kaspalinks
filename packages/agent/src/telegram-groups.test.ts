import { describe, expect, it } from "vitest";

import { isTelegramGroupAdminStatus } from "./telegram-api.ts";
import {
  groupStartPayload,
  parseTelegramCommand,
  parseTelegramGroupCommand,
} from "./telegram-commands.ts";
import {
  groupDecisionCallback,
  groupDecisionText,
  groupGiveawayMessage,
  groupPostedMessage,
  groupPostQuestion,
  groupSetupMessage,
  parseGroupDecisionCallback,
  privateGroupSetupMessage,
  telegramGroupMessageLink,
  telegramUpdateLabel,
  type GroupGiveawayFacts,
} from "./index.ts";

const facts: GroupGiveawayFacts = {
  amountKas: "50",
  closesAt: new Date("2026-11-09T18:00:00Z"),
  participantCap: 32,
  participantCount: 12,
  phase: "open",
  publicId: "cmw5608th04eh01mp050ej458",
  title: "Community giveaway",
  winnerAddress: null,
};
const appUrl = "https://kaspalinks.com/anything";

describe("group commands", () => {
  it("answers only its own giveaway and help commands", () => {
    expect(parseTelegramGroupCommand("/giveaway", "KaspaLinksBot")).toEqual({ kind: "giveaway" });
    expect(parseTelegramGroupCommand("/giveaway@kaspalinksbot 5 x", "KaspaLinksBot")).toEqual({
      kind: "giveaway",
    });
    expect(parseTelegramGroupCommand("/start@KaspaLinksBot giveaway", "@KaspaLinksBot")).toEqual({
      kind: "help",
    });
    expect(parseTelegramGroupCommand("/giveaway@OtherBot", "KaspaLinksBot")).toBeNull();
    expect(parseTelegramGroupCommand("/claim 5", "KaspaLinksBot")).toBeNull();
    expect(parseTelegramGroupCommand("hello /giveaway", "KaspaLinksBot")).toBeNull();
  });

  it("round-trips group chat ids through the start payload", () => {
    expect(groupStartPayload("-1001234567890")).toBe("grp_m1001234567890");
    expect(parseTelegramCommand("/start grp_m1001234567890")).toEqual({
      chatId: "-1001234567890",
      kind: "group_setup",
    });
    expect(parseTelegramCommand("/start grp_42")).toEqual({ chatId: "42", kind: "group_setup" });
    expect(() => groupStartPayload("-12; drop")).toThrow();
    // Anything else after /start is still a connection code.
    expect(parseTelegramCommand("/start grp_x1")).toEqual({ code: "grp_x1", kind: "connect" });
  });

  it("treats only owners and admins as group admins", () => {
    expect(isTelegramGroupAdminStatus("creator")).toBe(true);
    expect(isTelegramGroupAdminStatus("administrator")).toBe(true);
    expect(isTelegramGroupAdminStatus("member")).toBe(false);
    expect(isTelegramGroupAdminStatus("restricted")).toBe(false);
  });
});

describe("group setup messages", () => {
  it("sends admins from the group to the private chat with a URL button", () => {
    const message = groupSetupMessage({
      botUsername: "@KaspaLinksBot",
      chatId: "-1001234567890",
      title: "Kaspa Fans",
    });
    expect(message.text).toContain("Giveaway for Kaspa Fans");
    expect(message.buttons).toEqual([
      [{ text: "Set up giveaway", url: "https://t.me/KaspaLinksBot?start=grp_m1001234567890" }],
    ]);
  });

  it("opens the studio for that group from the private chat", () => {
    const message = privateGroupSetupMessage({ appUrl, chatId: "-100123", title: null });
    expect(message.text).toContain("Giveaway for this group");
    expect(message.buttons?.[0]?.[0]?.web_app?.url).toBe(
      "https://kaspalinks.com/telegram?mode=create&group=-100123",
    );
  });
});

describe("group giveaway posts", () => {
  it("announces an open giveaway with a join link", () => {
    const message = groupGiveawayMessage("announce", facts, appUrl)!;
    expect(message.text).toBe(
      [
        "🎁 Community giveaway",
        "50 KAS · free entry · fair on-chain draw",
        "12/32 spots taken · entries close 2026-11-09 18:00 UTC",
      ].join("\n"),
    );
    expect(message.buttons).toEqual([
      [
        {
          text: "Join giveaway",
          url: "https://kaspalinks.com/giveaways/cmw5608th04eh01mp050ej458?from=tg-group",
        },
      ],
    ]);
    expect(JSON.stringify(message)).not.toMatch(/web_app|callback_data/);
  });

  it("reminds only while spots are left", () => {
    expect(groupGiveawayMessage("reminder", facts, appUrl)!.text).toBe(
      [
        "⏰ Last call: Community giveaway",
        "50 KAS · 20 of 32 spots left · entries close 2026-11-09 18:00 UTC",
      ].join("\n"),
    );
    expect(groupGiveawayMessage("reminder", { ...facts, participantCount: 32 }, appUrl)).toBeNull();
    expect(groupGiveawayMessage("reminder", { ...facts, phase: "frozen" }, appUrl)).toBeNull();
  });

  it("posts the winner once drawn and stays quiet before that", () => {
    expect(groupGiveawayMessage("result", facts, appUrl)).toBeNull();
    const drawn = groupGiveawayMessage(
      "result",
      {
        ...facts,
        phase: "drawn",
        winnerAddress: "kaspa:qzk3m9w4l2xv8c7n6b5v4c3x2z1a0s9d8f7g6h5j4k3l2",
      },
      appUrl,
    )!;
    expect(drawn.text).toContain("🏆 Winner drawn: Community giveaway");
    expect(drawn.text).toContain("kaspa:qzk3m9…j4k3l2 won");
    expect(drawn.text).toContain("won 50 KAS, paid automatically on Kaspa.");
    expect(drawn.buttons?.[1]?.[0]?.url).toBe("https://kaspalinks.com/bot?from=tg-group");
    const returned = groupGiveawayMessage("result", { ...facts, phase: "returned" }, appUrl)!;
    expect(returned.text).toContain("without a winner");
  });
});

describe("post decision in the private chat", () => {
  const linkId = "cmw86npun000f0izbhdrj7yyt";

  it("asks with two callback buttons that fit Telegram's 64-byte limit", () => {
    const question = groupPostQuestion({
      amountKas: "50",
      groupTitle: "A very long Kaspa community group name for testing",
      linkId,
      title: "Community giveaway",
    });
    expect(question.text).toContain("Your giveaway is live 🎉");
    expect(question.text).toContain("Community giveaway · 50 KAS");
    const [[post], [skip]] = question.buttons as [
      [{ callback_data: string; text: string }],
      [{ callback_data: string }],
    ];
    expect(post.text).toBe("Post in A very long Kaspa community…");
    expect(post.callback_data).toBe(`group:post:${linkId}`);
    expect(skip.callback_data).toBe(`group:skip:${linkId}`);
    expect(Buffer.byteLength(post.callback_data)).toBeLessThanOrEqual(64);
  });

  it("parses only well-formed decisions", () => {
    expect(parseGroupDecisionCallback(`group:post:${linkId}`)).toEqual({
      decision: "post",
      linkId,
    });
    expect(parseGroupDecisionCallback(`group:skip:${linkId}`)).toEqual({
      decision: "skip",
      linkId,
    });
    expect(parseGroupDecisionCallback("group:post:../x")).toBeNull();
    expect(parseGroupDecisionCallback("watch:on:abc")).toBeNull();
    expect(() => groupDecisionCallback("post", "bad id")).toThrow();
    expect(telegramUpdateLabel({ callbackData: `group:post:${linkId}` })).toBe("button:group");
  });

  it("confirms the post with a link that works in supergroups only", () => {
    expect(telegramGroupMessageLink("-1001234567890", 42)).toBe("https://t.me/c/1234567890/42");
    expect(telegramGroupMessageLink("-4567", 42)).toBeNull();
    expect(
      groupPostedMessage({
        chatId: "-1001234567890",
        groupTitle: "Fans",
        messageId: 42,
        title: "Win",
      }),
    ).toEqual({
      text: "✓ Posted in Fans: Win",
      buttons: [[{ text: "Open the post", url: "https://t.me/c/1234567890/42" }]],
    });
    expect(groupPostedMessage({ chatId: "-4567", messageId: 42, title: "Win" })).toEqual({
      text: "✓ Posted in this group: Win",
    });
    expect(groupDecisionText("skip", "Fans")).toContain("won't post it in Fans");
  });
});
