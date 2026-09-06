import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decryptClaimableVaultValue,
  ensureTelegramMiniAppVaultSecret,
  encryptClaimableVaultValue,
  readEncryptedLocalJson,
  resolveClaimableVaultStorageKey,
  writeEncryptedLocalJson,
  removeEncryptedLocalJson,
} from "./claimable-vault";

import {
  saveClaimableRecord,
  loadClaimableRecords,
  type ClaimableStoreRecord,
} from "./claimable-store";

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
    expect(localStorage.getItem("recovery")).toBeNull();
    expect(localStorage.getItem(localStorage.key(0)!)).not.toContain("refundCode");
  });

  it("preserves both creators when accounts save in the same browser", async () => {
    const sessionStorage = memoryStorage();
    const localStorage = memoryStorage();
    vi.stubGlobal("window", { sessionStorage, localStorage });
    const key = "kaspa-actions:creator-token";
    const record = (id: string) =>
      ({ id, createdAtMs: 1, manageUrl: `synthetic-${id}` }) as ClaimableStoreRecord;
    sessionStorage.setItem(key, "synthetic-A");
    await saveClaimableRecord(record("A"));
    sessionStorage.setItem(key, "synthetic-B");
    await saveClaimableRecord(record("B"));
    sessionStorage.setItem(key, "synthetic-A");
    expect((await loadClaimableRecords()).map((r) => r.id)).toEqual(["A"]);
    sessionStorage.setItem(key, "synthetic-B");
    expect((await loadClaimableRecords()).map((r) => r.id)).toEqual(["B"]);
    expect(localStorage.length).toBe(2);
  });

  it("preserves a foreign legacy envelope until its owner migrates it", async () => {
    const envelope = JSON.stringify(
      await encryptClaimableVaultValue(["A"], "synthetic-A", "recovery"),
    );
    const localStorage = memoryStorage({ recovery: envelope });
    const sessionStorage = memoryStorage({ "kaspa-actions:creator-token": "synthetic-B" });
    vi.stubGlobal("window", { localStorage, sessionStorage });
    await expect(readEncryptedLocalJson("recovery")).resolves.toEqual({
      locked: false,
      value: null,
    });
    await writeEncryptedLocalJson("recovery", ["B"]);
    expect(localStorage.getItem("recovery")).toBe(envelope);
    sessionStorage.setItem("kaspa-actions:creator-token", "synthetic-A");
    await expect(readEncryptedLocalJson("recovery")).resolves.toEqual({
      locked: false,
      value: ["A"],
    });
    await removeEncryptedLocalJson("recovery");
    sessionStorage.setItem("kaspa-actions:creator-token", "synthetic-B");
    await expect(readEncryptedLocalJson("recovery")).resolves.toEqual({
      locked: false,
      value: ["B"],
    });
  });

  it("never overwrites or removes a damaged scoped envelope", async () => {
    const localStorage = memoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage: memoryStorage({ "kaspa-actions:creator-token": "synthetic-A" }),
    });
    await writeEncryptedLocalJson("recovery", ["A"]);
    const key = localStorage.key(0)!;
    localStorage.setItem(key, "damaged ciphertext");
    await expect(readEncryptedLocalJson("recovery")).resolves.toEqual({
      locked: true,
      value: null,
    });
    await expect(writeEncryptedLocalJson("recovery", ["B"])).rejects.toThrow();
    await expect(removeEncryptedLocalJson("recovery")).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe("damaged ciphertext");
  });

  it("does not complete a write after the browser changes account", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage({ "kaspa-actions:creator-token": "synthetic-A" });
    vi.stubGlobal("window", { localStorage, sessionStorage });
    const pending = writeEncryptedLocalJson("recovery", ["A"]);
    sessionStorage.setItem("kaspa-actions:creator-token", "synthetic-B");
    await expect(pending).rejects.toThrow("session changed");
    expect(localStorage.length).toBe(0);
  });

  it("keeps Telegram Mini App recovery in a separate browser vault", () => {
    const sessionStorage = memoryStorage();
    vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage });

    const secret = ensureTelegramMiniAppVaultSecret();

    expect(secret).toHaveLength(43);
    expect(resolveClaimableVaultStorageKey("recovery")).toBe("recovery.telegram-mini-app");
  });

  it("prefers the signed-in creator vault over the Mini App vault", () => {
    const sessionStorage = memoryStorage({
      "kaspa-actions:creator-token": "ka_creator_existing",
      "kaspa-actions:telegram-mini-app-vault-key": "mini-app-key",
    });
    vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage });

    expect(resolveClaimableVaultStorageKey("recovery")).toBe("recovery");
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
