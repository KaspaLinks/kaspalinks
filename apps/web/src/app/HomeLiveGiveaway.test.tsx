import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeLiveGiveaway } from "./HomeLiveGiveaway";

const giveaway = {
  amountKas: "100",
  closesAt: new Date("2026-11-08T12:00:00.000Z"),
  participantCap: 32,
  participantCount: 12,
  publicId: "cmw6m0itx04jz01r32nhaa4g7",
};

describe("HomeLiveGiveaway", () => {
  it("links to the giveaway with the prize, free spots and close time", () => {
    const html = renderToStaticMarkup(<HomeLiveGiveaway giveaway={giveaway} />);

    expect(html).toContain('href="/giveaways/cmw6m0itx04jz01r32nhaa4g7?from=home"');
    expect(html).toContain("Live giveaway");
    expect(html).toContain("100 KAS");
    expect(html).toContain("20 of 32 spots left");
    expect(html).toContain('<time dateTime="2026-11-08T12:00:00.000Z">Nov 8, 12:00 UTC</time>');
    expect(html).toContain("Join free");
  });

  it("names the last spot plainly", () => {
    const html = renderToStaticMarkup(
      <HomeLiveGiveaway giveaway={{ ...giveaway, participantCount: 31 }} />,
    );

    expect(html).toContain("1 spot left");
  });
});
