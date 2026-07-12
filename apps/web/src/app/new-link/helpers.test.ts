import { describe, expect, it } from "vitest";

import { slugify, validateRecipientAddress } from "./helpers";

const VALID_ADDRESS = "kaspa:qpauqsvk7yf9unexwmxsnmg547mhyga37csh0kj53q6xxgl24ydxjsgzthw5j";

describe("new-link helpers", () => {
  it("slugifies titles for human-readable links", () => {
    expect(slugify("  My Great Stream Tip Jar!  ")).toBe("my-great-stream-tip-jar");
    expect(slugify("a___b   c")).toBe("a-b-c");
    expect(slugify("x".repeat(80))).toHaveLength(64);
  });

  it("validates likely mainnet addresses before submit", () => {
    expect(validateRecipientAddress("")).toEqual({ state: "empty" });
    expect(validateRecipientAddress(VALID_ADDRESS)).toEqual({ state: "valid" });
    expect(validateRecipientAddress(VALID_ADDRESS.replace("kaspa:", "kaspatest:"))).toMatchObject({
      state: "invalid",
    });
    expect(validateRecipientAddress("kaspa:hallo")).toMatchObject({ state: "invalid" });
  });
});
