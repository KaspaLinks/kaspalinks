import { describe, expect, it } from "vitest";

import { isInternalCreator, readInternalCreatorUsernames } from "./internal-creators";

describe("internal creators", () => {
  it("reads a comma-separated, case-insensitive list", () => {
    const env = { INTERNAL_CREATOR_USERNAMES: " Example , qa-bot ,," };

    expect([...readInternalCreatorUsernames(env)]).toEqual(["example", "qa-bot"]);
    expect(isInternalCreator("EXAMPLE", env)).toBe(true);
    expect(isInternalCreator("qa-bot", env)).toBe(true);
    expect(isInternalCreator("examples", env)).toBe(false);
  });

  it("treats nobody as internal without a list", () => {
    expect(readInternalCreatorUsernames({}).size).toBe(0);
    expect(isInternalCreator("example", { INTERNAL_CREATOR_USERNAMES: "" })).toBe(false);
  });
});
