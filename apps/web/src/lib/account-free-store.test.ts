import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_FREE_STORE_KEY,
  addAccountFreeEntry,
  buildManageUrl,
  createManageToken,
  hashManageTokenInBrowser,
  readAccountFreeEntries,
  removeAccountFreeEntries,
  type AccountFreePaymentEntry,
} from "./account-free-store";
import { hashManageToken } from "./account-free-links";

function payment(publicId: string): AccountFreePaymentEntry {
  return {
    createdAt: "2026-10-18T10:00:00.000Z",
    kind: "payment",
    manageToken: createManageToken(),
    publicId,
    title: `Link ${publicId}`,
    type: "kaspa.tip",
  };
}

describe("account-free store", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the newest entry first and never duplicates a link", () => {
    addAccountFreeEntry(payment("one"));
    addAccountFreeEntry(payment("two"));
    addAccountFreeEntry({ ...payment("one"), title: "Renamed" });

    const entries = readAccountFreeEntries();
    expect(entries.map((entry) => entry.title)).toEqual(["Renamed", "Link two"]);
  });

  it("removes moved links and ignores damaged storage", () => {
    const one = payment("one");
    addAccountFreeEntry(one);
    addAccountFreeEntry(payment("two"));
    removeAccountFreeEntries([one]);
    expect(readAccountFreeEntries().map((entry) => entry.title)).toEqual(["Link two"]);

    storage.set(ACCOUNT_FREE_STORE_KEY, "{broken");
    expect(readAccountFreeEntries()).toEqual([]);
    storage.set(ACCOUNT_FREE_STORE_KEY, JSON.stringify([{ kind: "payment" }, "x"]));
    expect(readAccountFreeEntries()).toEqual([]);
  });

  it("reports when the browser cannot store the link", () => {
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(addAccountFreeEntry(payment("one"))).toBe(false);
  });
});

describe("manage tokens", () => {
  it("creates tokens the server accepts and hashes them identically", async () => {
    const token = createManageToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createManageToken()).not.toBe(token);
    expect(await hashManageTokenInBrowser(token)).toBe(hashManageToken(token));
    expect(await hashManageTokenInBrowser(token)).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
  });

  it("puts the token only in the URL fragment", () => {
    const url = new URL(buildManageUrl("https://kaspalinks.com", "abc123", "tok_en-1"));
    expect(url.pathname).toBe("/manage/abc123");
    expect(url.search).toBe("");
    expect(url.hash).toBe("#token=tok_en-1");
  });
});
