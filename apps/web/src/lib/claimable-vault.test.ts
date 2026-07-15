import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decryptClaimableVaultValue,
  encryptClaimableVaultValue,
  readEncryptedLocalJson,
} from "./claimable-vault";

describe("claimable recovery vault", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips Unicode recovery data without exposing plaintext", async () => {
    const value = {
      claimUrl: "https://kaspalinks.com/claim#gift=Grüße-🎁",
      refundCode: "a".repeat(64),
    };
    const envelope = await encryptClaimableVaultValue(
      value,
      "ka_creator_test-secret",
      "claimable-test",
    );

    expect(JSON.stringify(envelope)).not.toContain("refundCode");
    await expect(
      decryptClaimableVaultValue<typeof value>(
        envelope,
        "ka_creator_test-secret",
        "claimable-test",
      ),
    ).resolves.toEqual(value);
  });

  it("rejects a different creator token", async () => {
    const envelope = await encryptClaimableVaultValue(
      { manageUrl: "private" },
      "ka_creator_correct",
      "claimable-test",
    );

    await expect(
      decryptClaimableVaultValue(envelope, "ka_creator_wrong", "claimable-test"),
    ).rejects.toThrow();
  });

  it("does not expose legacy plaintext recovery while signed out", async () => {
    const localStorage = memoryStorage({ recovery: JSON.stringify({ refundCode: "private" }) });
    vi.stubGlobal("window", { localStorage, sessionStorage: memoryStorage() });

    await expect(readEncryptedLocalJson("recovery")).resolves.toEqual({
      locked: true,
      value: null,
    });
    expect(localStorage.getItem("recovery")).toContain("refundCode");
  });

  it("migrates legacy plaintext to an encrypted envelope when signed in", async () => {
    const localStorage = memoryStorage({ recovery: JSON.stringify({ refundCode: "private" }) });
    const sessionStorage = memoryStorage({
      "kaspa-actions:creator-token": "ka_creator_migration-secret",
    });
    vi.stubGlobal("window", { localStorage, sessionStorage });

    await expect(readEncryptedLocalJson("recovery")).resolves.toEqual({
      locked: false,
      value: { refundCode: "private" },
    });
    expect(localStorage.getItem("recovery")).not.toContain("refundCode");
  });
});

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}
