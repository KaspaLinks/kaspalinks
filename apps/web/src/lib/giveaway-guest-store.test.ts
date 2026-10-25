import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setSealKeyProviderForTests } from "./browser-seal";
import { GUEST_STORAGE_KEY, readStoredGuest, storeGuest } from "./giveaway-guest-store";

const GUEST = { token: "ka_creator_secret-guest-token", username: "guest-abc234defg" };

describe("giveaway guest store", () => {
  let storage: Map<string, string>;

  beforeEach(async () => {
    storage = new Map();
    const key = await crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, false, [
      "decrypt",
      "encrypt",
    ]);
    setSealKeyProviderForTests(async () => key);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (name: string) => storage.get(name) ?? null,
        removeItem: (name: string) => storage.delete(name),
        setItem: (name: string, value: string) => storage.set(name, value),
      },
    });
  });

  afterEach(() => {
    setSealKeyProviderForTests(null);
    vi.unstubAllGlobals();
  });

  it("keeps the guest token only sealed", async () => {
    expect(await storeGuest(GUEST)).toBe(true);
    expect(storage.get(GUEST_STORAGE_KEY)).not.toContain("secret-guest-token");
    expect(await readStoredGuest()).toEqual(GUEST);
  });

  it("seals a guest stored in plain text before", async () => {
    storage.set(GUEST_STORAGE_KEY, JSON.stringify(GUEST));

    expect(await readStoredGuest()).toEqual(GUEST);
    expect(storage.get(GUEST_STORAGE_KEY)).not.toContain("secret-guest-token");
    expect(await readStoredGuest()).toEqual(GUEST);
  });

  it("drops a plain-text guest it cannot seal and stores nothing new", async () => {
    setSealKeyProviderForTests(async () => null);
    storage.set(GUEST_STORAGE_KEY, JSON.stringify(GUEST));

    expect(await readStoredGuest()).toEqual(GUEST);
    expect(storage.has(GUEST_STORAGE_KEY)).toBe(false);
    expect(await storeGuest(GUEST)).toBe(false);
    expect(storage.has(GUEST_STORAGE_KEY)).toBe(false);
  });
});
