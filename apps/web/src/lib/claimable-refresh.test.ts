import { describe, expect, it } from "vitest";

import { selectRotatingWindow } from "./claimable-refresh";

describe("selectRotatingWindow", () => {
  it("eventually selects every link when the list is larger than the refresh cap", () => {
    const links = Array.from({ length: 18 }, (_, index) => index);
    const first = selectRotatingWindow(links, 0, 8);
    const second = selectRotatingWindow(links, first.nextCursor, 8);
    const third = selectRotatingWindow(links, second.nextCursor, 8);

    expect(new Set([...first.items, ...second.items, ...third.items])).toEqual(
      new Set(links),
    );
  });

  it("does not duplicate a short list", () => {
    expect(selectRotatingWindow(["a", "b"], 0, 8)).toEqual({
      items: ["a", "b"],
      nextCursor: 0,
    });
  });
});
