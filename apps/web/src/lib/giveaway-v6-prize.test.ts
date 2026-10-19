import { describe, expect, it } from "vitest";

import { formatGiveawayV6Prize, parseGiveawayV6Prize } from "./giveaway-v6-prize";

describe("parseGiveawayV6Prize", () => {
  it("accepts any amount from 0.2 KAS, also very large ones", () => {
    expect(parseGiveawayV6Prize("0.2")).toEqual({ ok: true, sompi: 20_000_000n });
    expect(parseGiveawayV6Prize("100")).toEqual({ ok: true, sompi: 10_000_000_000n });
    expect(parseGiveawayV6Prize("100000")).toEqual({ ok: true, sompi: 10_000_000_000_000n });
    expect(parseGiveawayV6Prize("2,5")).toEqual({ ok: true, sompi: 250_000_000n });
    expect(parseGiveawayV6Prize("0.12345678")).toMatchObject({ ok: false });
  });

  it("refuses dust, malformed input and more than the total supply", () => {
    expect(parseGiveawayV6Prize("0.19999999")).toEqual({
      ok: false,
      reason: "The prize must be at least 0.2 KAS.",
    });
    expect(parseGiveawayV6Prize("1.123456789")).toMatchObject({ ok: false });
    expect(parseGiveawayV6Prize("-1")).toMatchObject({ ok: false });
    expect(parseGiveawayV6Prize("")).toMatchObject({ ok: false });
    expect(parseGiveawayV6Prize("30000000000")).toEqual({
      ok: false,
      reason: "The prize is larger than all KAS that will ever exist.",
    });
  });

  it("formats prizes the way they are stored", () => {
    expect(formatGiveawayV6Prize(10_000_000_000_000n)).toBe("100000");
    expect(formatGiveawayV6Prize(25_000_000n)).toBe("0.25");
  });
});
