import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashManageToken } from "./account-free-links";
import {
  ACCOUNT_FREE_STORE_KEY,
  addAccountFreeEntry,
  buildManageUrl,
  createManageToken,
  hashManageTokenInBrowser,
  listAccountFreeEntries,
  readAccountFreeEntries,
  removeAccountFreeEntries,
  type AccountFreeClaimEntry,
  type AccountFreePaymentEntry,
} from "./account-free-store";
import { setSealKeyProviderForTests } from "./browser-seal";

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

function claim(linkKey: string): AccountFreeClaimEntry {
  return {
    amountKas: "1",
    claimUrl: `https://kaspalinks.com/claim/${linkKey}#c=claim-code-${linkKey}`,
    createdAt: "2026-10-18T10:00:00.000Z",
    kind: "claim",
    linkKey,
    manageToken: createManageToken(),
    title: `Gift ${linkKey}`,
  };
}

describe("account-free store", () => {
  let storage: Map<string, string>;

  beforeEach(async () => {
    storage = new Map();
    const key = await crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, false, [
      "decrypt",
      "encrypt",
    ]);
    setSealKeyProviderForTests(async () => key);
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      localStorage: {
        getItem: (name: string) => storage.get(name) ?? null,
        setItem: (name: string, value: string) => storage.set(name, value),
      },
    });
  });

  afterEach(() => {
    setSealKeyProviderForTests(null);
    vi.unstubAllGlobals();
  });

  it("keeps the newest entry first and never duplicates a link", async () => {
    await addAccountFreeEntry(payment("one"));
    await addAccountFreeEntry(payment("two"));
    await addAccountFreeEntry({ ...payment("one"), title: "Renamed" });

    const entries = await readAccountFreeEntries();
    expect(entries.map((entry) => entry.title)).toEqual(["Renamed", "Link two"]);
  });

  it("stores manage tokens and claim codes only sealed", async () => {
    const gift = claim("lab-1");
    const link = payment("one");
    await addAccountFreeEntry(gift);
    await addAccountFreeEntry(link);

    const raw = storage.get(ACCOUNT_FREE_STORE_KEY) ?? "";
    expect(raw).not.toContain("claim-code-lab-1");
    expect(raw).not.toContain(gift.manageToken);
    expect(raw).not.toContain(link.manageToken);
    expect(raw).toContain("Gift lab-1");
    expect(listAccountFreeEntries().map((entry) => entry.title)).toEqual([
      "Link one",
      "Gift lab-1",
    ]);

    const opened = await readAccountFreeEntries();
    expect(opened).toContainEqual(gift);
    expect(opened).toContainEqual(link);
  });

  it("seals entries written in plain text before", async () => {
    const legacy = claim("lab-old");
    storage.set(ACCOUNT_FREE_STORE_KEY, JSON.stringify([legacy]));

    expect(await readAccountFreeEntries()).toEqual([legacy]);
    const raw = storage.get(ACCOUNT_FREE_STORE_KEY) ?? "";
    expect(raw).not.toContain("claim-code-lab-old");
    expect(await readAccountFreeEntries()).toEqual([legacy]);
  });

  it("removes links and ignores damaged storage", async () => {
    await addAccountFreeEntry(payment("one"));
    await addAccountFreeEntry(payment("two"));
    removeAccountFreeEntries([{ kind: "payment", publicId: "one" }]);
    expect((await readAccountFreeEntries()).map((entry) => entry.title)).toEqual(["Link two"]);

    storage.set(ACCOUNT_FREE_STORE_KEY, "{broken");
    expect(await readAccountFreeEntries()).toEqual([]);
    storage.set(ACCOUNT_FREE_STORE_KEY, JSON.stringify([{ kind: "payment" }, "x"]));
    expect(await readAccountFreeEntries()).toEqual([]);
  });

  it("reports when the browser cannot store the link", async () => {
    setSealKeyProviderForTests(async () => null);
    expect(await addAccountFreeEntry(payment("one"))).toBe(false);
    expect(storage.size).toBe(0);
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
