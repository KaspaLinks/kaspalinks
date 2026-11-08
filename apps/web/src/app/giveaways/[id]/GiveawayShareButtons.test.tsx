import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GiveawayShareButtons, giveawayShareLinks } from "./GiveawayShareButtons";

const ID = "cmw6m0itx04jz01r32nhaa4g7";
const PAGE = `https://kaspalinks.com/giveaways/${ID}`;

describe("GiveawayShareButtons", () => {
  it("renders nothing on the server, where the page address is unknown", () => {
    expect(renderToStaticMarkup(<GiveawayShareButtons amountKas="100" publicId={ID} />)).toBe("");
  });

  it("builds Telegram and X shares that point back to the giveaway", () => {
    const links = giveawayShareLinks("https://kaspalinks.com", ID, "100");
    const telegram = new URL(links.telegram);
    const x = new URL(links.x);

    expect(telegram.origin + telegram.pathname).toBe("https://t.me/share/url");
    expect(telegram.searchParams.get("url")).toBe(`${PAGE}?from=share-tg`);
    expect(telegram.searchParams.get("text")).toBe(
      "I just joined a free 100 KAS giveaway on Kaspa. Fair on-chain draw, no account needed 👇",
    );
    expect(x.origin + x.pathname).toBe("https://x.com/intent/post");
    expect(x.searchParams.get("url")).toBe(`${PAGE}?from=share-x`);
    expect(links.copy).toBe(`${PAGE}?from=share-link`);
  });
});
