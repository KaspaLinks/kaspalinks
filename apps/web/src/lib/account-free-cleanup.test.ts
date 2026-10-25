import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ removeAccountFreeEntries: vi.fn() }));
vi.mock("./account-free-store", () => ({
  removeAccountFreeEntries: mocks.removeAccountFreeEntries,
}));

import { forgetFinishedClaimLinks } from "./account-free-cleanup";
import type { AccountFreeEntry } from "./account-free-store";

function claim(linkKey: string): AccountFreeEntry {
  return {
    amountKas: "1",
    claimUrl: `https://kaspalinks.com/claim/${linkKey}#c=code`,
    createdAt: "2026-10-18T10:00:00.000Z",
    kind: "claim",
    linkKey,
    manageToken: "token",
    title: linkKey,
  };
}

describe("forgetFinishedClaimLinks", () => {
  it("forgets claimed, returned and vanished links but keeps open ones", async () => {
    mocks.removeAccountFreeEntries.mockClear();
    const entries = [claim("open"), claim("claimed"), claim("returned"), claim("gone")];

    const removed = await forgetFinishedClaimLinks(entries, async () => ({
      claimed: "claimed",
      open: "shared",
      returned: "refunded",
    }));

    expect(removed).toBe(3);
    expect(
      mocks.removeAccountFreeEntries.mock.calls[0]?.[0].map(
        (entry: { linkKey: string }) => entry.linkKey,
      ),
    ).toEqual(["claimed", "returned", "gone"]);
  });

  it("keeps every claim code when the status lookup fails", async () => {
    mocks.removeAccountFreeEntries.mockClear();
    expect(await forgetFinishedClaimLinks([claim("a")], async () => null)).toBe(0);
    expect(mocks.removeAccountFreeEntries).not.toHaveBeenCalled();
  });
});
