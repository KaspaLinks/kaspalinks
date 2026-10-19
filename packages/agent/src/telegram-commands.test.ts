import { describe, expect, it } from "vitest";

import {
  TelegramCommandError,
  parseTelegramCommand,
  slugifyAgentTitle,
  telegramUpdateLabel,
} from "./telegram-commands.ts";

describe("parseTelegramCommand", () => {
  it.each([
    ["/link 1.5 Website work", "kaspa.transfer", "1.5"],
    ["/invoice 12,75 Invoice 184", "kaspa.invoice", "12.75"],
    ["/tip 2 Coffee", "kaspa.tip", "2"],
    ["/donation 3 Community fund", "kaspa.donation", "3"],
    ["/goal 100 New microphone", "kaspa.goal", "100"],
  ] as const)("parses %s", (text, type, amountKas) => {
    expect(parseTelegramCommand(text)).toMatchObject({
      amountKas,
      kind: "create_action",
      type,
    });
  });

  it("keeps tip and donation amounts optional", () => {
    expect(parseTelegramCommand("/tip Buy me a coffee")).toEqual({
      kind: "create_action",
      title: "Buy me a coffee",
      type: "kaspa.tip",
    });
  });

  it.each([
    "/invoice Invoice 184",
    "/link 0 Invalid transfer",
    "/goal 1e3 Scientific notation",
    "/donation 1.123456789 Too precise",
  ])("rejects an invalid required or numeric amount in %s", (text) => {
    expect(() => parseTelegramCommand(text)).toThrow(TelegramCommandError);
  });

  it("rejects titles over 80 characters", () => {
    expect(() => parseTelegramCommand(`/tip ${"x".repeat(81)}`)).toThrow(
      "Title must be 80 characters or shorter.",
    );
  });

  it("parses bot-qualified commands and connection deep links", () => {
    expect(parseTelegramCommand("/stats@KaspaLinksBot")).toEqual({ kind: "stats" });
    expect(parseTelegramCommand("/start one-time-code")).toEqual({
      code: "one-time-code",
      kind: "connect",
    });
  });

  it("parses a giveaway handoff without creating wallet material", () => {
    expect(parseTelegramCommand("/giveaway 0,5 Weekend KAS")).toEqual({
      amountKas: "0.5",
      kind: "prepare_giveaway",
      title: "Weekend KAS",
    });
    expect(parseTelegramCommand("/giveaways")).toEqual({ kind: "giveaways" });
  });

  it.each([
    "/giveaway soon Weekend",
    "/giveaway 0.1 Too small",
    "/giveaway 0 Empty reward",
    "/giveaway 0.5",
  ])("rejects invalid giveaway setup in %s", (text) => {
    expect(() => parseTelegramCommand(text)).toThrow(TelegramCommandError);
  });

  it("parses a claim link handoff with an optional title", () => {
    expect(parseTelegramCommand("/claim 2,5 Coffee for Ada")).toEqual({
      amountKas: "2.5",
      kind: "prepare_claim",
      title: "Coffee for Ada",
    });
    expect(parseTelegramCommand("/claim 1")).toEqual({
      amountKas: "1",
      kind: "prepare_claim",
      title: "",
    });
    expect(() => parseTelegramCommand("/claim")).toThrow("Use /claim <KAS> [title].");
    expect(() => parseTelegramCommand("/claim lots")).toThrow(TelegramCommandError);
  });

  it("reads or sets the wallet for payment links", () => {
    expect(parseTelegramCommand("/wallet")).toEqual({ kind: "show_wallet" });
    expect(parseTelegramCommand("/wallet Kaspa:QQABC")).toEqual({
      address: "kaspa:qqabc",
      kind: "set_wallet",
    });
  });

  it("points an old-style duration to the fixed draw times", () => {
    expect(() => parseTelegramCommand("/giveaway 0.5 24h Weekend KAS")).toThrow(
      "Giveaways now end at fixed draw times",
    );
  });
});

describe("slugifyAgentTitle", () => {
  it("creates stable ASCII URL candidates", () => {
    expect(slugifyAgentTitle("Kaffee für Änne")).toBe("kaffee-fur-anne");
    expect(slugifyAgentTitle("$KAS")).toBe("kas");
  });
});

describe("telegramUpdateLabel", () => {
  it("labels commands from a fixed list and never keeps their arguments", () => {
    expect(telegramUpdateLabel({ text: "/claim 5 Coffee for Ada" })).toBe("/claim");
    expect(telegramUpdateLabel({ text: "/START@KaspaLinksBot g_abc" })).toBe("/start");
    expect(telegramUpdateLabel({ text: "/wallet kaspa:qpauqsvk7yf9" })).toBe("/wallet");
    expect(telegramUpdateLabel({ text: "/whatever secret" })).toBe("/other");
  });

  it("keeps free text and buttons coarse", () => {
    expect(telegramUpdateLabel({ text: "hello, my name is Ada" })).toBe("text");
    expect(telegramUpdateLabel({ callbackData: "menu:links" })).toBe("button:menu");
    expect(telegramUpdateLabel({ callbackData: "watch:on:g1" })).toBe("button:watch");
    expect(telegramUpdateLabel({ callbackData: "custom:1" })).toBe("button:other");
    expect(telegramUpdateLabel({ text: "  " })).toBeNull();
  });
});

describe("giveaway prizes", () => {
  it("accepts any prize from 0.2 KAS, also large ones", () => {
    expect(parseTelegramCommand("/giveaway 100000 Big drop")).toEqual({
      amountKas: "100000",
      kind: "prepare_giveaway",
      title: "Big drop",
    });
    expect(parseTelegramCommand("/giveaway 0,2 Small")).toMatchObject({ amountKas: "0.2" });
  });
});
