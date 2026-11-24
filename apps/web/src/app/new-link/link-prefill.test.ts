import { describe, expect, it } from "vitest";

import { buildLinkPrefillHash, parseLinkPrefill } from "./link-prefill";

const ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

describe("link prefill", () => {
  it("round-trips address, amount and title through the fragment", () => {
    const hash = buildLinkPrefillHash({
      amountKas: "12.5",
      recipientAddress: ADDRESS,
      title: "Coffee & cake",
    });
    expect(hash.startsWith("#")).toBe(true);
    expect(parseLinkPrefill(hash)).toEqual({
      amountKas: "12.5",
      recipientAddress: ADDRESS,
      title: "Coffee & cake",
    });
  });

  it("returns an empty fragment when there is nothing to hand over", () => {
    expect(buildLinkPrefillHash({})).toBe("");
    expect(parseLinkPrefill("")).toEqual({});
  });

  it("drops each invalid value on its own", () => {
    expect(parseLinkPrefill(`#to=kaspatest:${ADDRESS.slice(6)}&amount=1e3&title=%20%20`)).toEqual(
      {},
    );
    expect(parseLinkPrefill(`#to=${ADDRESS}&amount=0`)).toEqual({ recipientAddress: ADDRESS });
    expect(parseLinkPrefill("#amount=0.000000001")).toEqual({});
    expect(parseLinkPrefill("#amount=-5")).toEqual({});
    expect(parseLinkPrefill("#amount=25")).toEqual({ amountKas: "25" });
  });

  it("collapses whitespace and caps the title", () => {
    const long = "a".repeat(120);
    expect(parseLinkPrefill(`#title=${long}`).title).toHaveLength(80);
    expect(parseLinkPrefill("#title=Buy%0Ame%20%20a%20coffee").title).toBe("Buy me a coffee");
  });
});
