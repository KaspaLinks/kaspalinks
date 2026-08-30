import { describe, expect, it } from "vitest";

import {
  TelegramCommandError,
  parseTelegramCommand,
  slugifyAgentTitle,
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
    expect(parseTelegramCommand("/giveaway 10,5 24h Weekend KAS")).toEqual({
      amountKas: "10.5",
      entryWindowSeconds: 86_400,
      kind: "prepare_giveaway",
      title: "Weekend KAS",
    });
    expect(parseTelegramCommand("/giveaways")).toEqual({ kind: "giveaways" });
  });

  it.each([
    "/giveaway 10 soon Weekend",
    "/giveaway 10 8d Too long",
    "/giveaway 0 1h Empty reward",
    "/giveaway 10 1h",
  ])("rejects invalid giveaway setup in %s", (text) => {
    expect(() => parseTelegramCommand(text)).toThrow(TelegramCommandError);
  });
});

describe("slugifyAgentTitle", () => {
  it("creates stable ASCII URL candidates", () => {
    expect(slugifyAgentTitle("Kaffee für Änne")).toBe("kaffee-fur-anne");
    expect(slugifyAgentTitle("$KAS")).toBe("kas");
  });
});
