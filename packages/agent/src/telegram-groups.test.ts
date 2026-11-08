import { describe, expect, it } from "vitest";

import { isTelegramGroupAdminStatus } from "./telegram-api.ts";
import {
  groupStartPayload,
  parseTelegramCommand,
  parseTelegramGroupCommand,
} from "./telegram-commands.ts";
import {
  groupGiveawayMessage,
  groupSetupMessage,
  privateGroupSetupMessage,
  type GroupGiveawayFacts,
} from "./telegram-groups.ts";

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
