import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./GiveawayLabClient", () => ({ GiveawayLabClient: () => null }));
vi.mock("@/lib/giveaway-lab", () => ({ isGiveawayLabEnabled: () => true }));
Object.assign(globalThis, { React });

import GiveawayLabPage from "./page";

describe("giveaway entry routes", () => {
  it("opens management even when a draft is present", async () => {
    const page = await GiveawayLabPage({
      searchParams: Promise.resolve({ view: "manage", draft: "old-draft" }),
    });
    expect(page.props.initialView).toBe("manage");
  });

  it.each([undefined, "create", ["manage", "create"]])(
    "keeps creation URLs compatible (%s)",
    async (view) => {
      const page = await GiveawayLabPage({
        searchParams: Promise.resolve({ view, draft: "draft-1" }),
      });
      expect(page.props.initialView).toBe("details");
      expect(page.props.draftId).toBe("draft-1");
    },
  );
});
