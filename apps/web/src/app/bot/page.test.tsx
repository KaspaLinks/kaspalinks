import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import BotPage from "./page";

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
});

describe("BotPage", () => {
  it("links to the bot and explains how to find it when Start does nothing", () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "@kaspalinksbot");
    const html = renderToStaticMarkup(<BotPage />);

    expect(html).toContain('href="https://t.me/kaspalinksbot"');
    expect(html).toContain("Open @kaspalinksbot in Telegram");
    expect(html).toContain("Nothing happens when you tap Start?");
    expect(html).toContain("<code>@kaspalinksbot</code>");
    for (const feature of ["Send KAS", "Get paid", "Giveaway", "My links"]) {
      expect(html).toContain(`<strong>${feature}</strong>`);
    }
    // Groups: Telegram's group picker, then the bot asks admins to send /giveaway.
    expect(html).toContain('href="https://t.me/kaspalinksbot?startgroup=giveaway"');
  });

  it("is not found without a valid bot username", () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "no");
    expect(() => renderToStaticMarkup(<BotPage />)).toThrow("NEXT_NOT_FOUND");
  });
});
