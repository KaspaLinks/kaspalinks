const CREATOR_TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const TELEGRAM_MINI_APP_VAULT_KEY = "kaspa-actions:telegram-mini-app-vault-key";
const ENVELOPE_VERSION = 1;

type VaultEnvelope = {
  algorithm: "AES-GCM";
  ciphertext: string;
  iv: string;
  salt: string;
  version: 1;
};

export type EncryptedLocalRead<T> = {
  locked: boolean;
  value: T | null;
};

// Namespace every encrypted store by a one-way, domain-separated identifier.
// The creator token itself remains sessionStorage-only. Old shared envelopes
// are migrated only by the session that can successfully decrypt them.
async function scopedStorageKey(storageKey: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`Kaspa Links vault namespace:${secret}`),
  );
  return `${storageKey}.v2.${bytesToBase64Url(new Uint8Array(digest))}`;
}

export function assertClaimableVaultSession(): () => void {
  const secret = readCreatorVaultSecret();
  return () => {
    if (!secret || readCreatorVaultSecret() !== secret) {
      throw new Error("Your recovery session changed. Reload before saving recovery data.");
    }
  };
}

export async function readEncryptedLocalJson<T>(
  storageKey: string,
): Promise<EncryptedLocalRead<T>> {
  if (typeof window === "undefined") return { locked: false, value: null };
  const secret = readCreatorVaultSecret();
  if (!secret) {
    return { locked: window.localStorage.getItem(storageKey) !== null, value: null };
  }
  const assertSession = assertClaimableVaultSession();
  const scopedKey = await scopedStorageKey(storageKey, secret);
  const scoped = window.localStorage.getItem(scopedKey);
  const raw = scoped ?? window.localStorage.getItem(storageKey);
  if (raw === null) return { locked: false, value: null };

  try {
    const parsed: unknown = JSON.parse(raw);
    // Scoped stores must always contain authenticated ciphertext.
    if (scoped !== null && !isVaultEnvelope(parsed)) return { locked: true, value: null };
    const value = isVaultEnvelope(parsed)
      ? await decryptClaimableVaultValue<T>(
          parsed,
          secret,
          scoped !== null ? scopedKey : storageKey,
        )
      : (parsed as T);
    assertSession();
    if (scoped === null) {
      const envelope = await encryptClaimableVaultValue(value, secret, scopedKey);
      assertSession();
      // Never overwrite another tab's successful migration/write.
      if (window.localStorage.getItem(scopedKey) !== null)
        return readEncryptedLocalJson<T>(storageKey);
      window.localStorage.setItem(scopedKey, JSON.stringify(envelope));
      if (window.localStorage.getItem(storageKey) === raw)
        window.localStorage.removeItem(storageKey);
    }
    return { locked: false, value };
  } catch {
    // An inaccessible legacy envelope may belong to another creator. Preserve
    // it; the new account can use its own independent namespace safely.
    return { locked: scoped !== null, value: null };
  }
}

export async function writeEncryptedLocalJson(storageKey: string, value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const assertSession = assertClaimableVaultSession();
  assertSession();
  const secret = readCreatorVaultSecret();
  const scopedKey = await scopedStorageKey(storageKey, secret);
  const existing = window.localStorage.getItem(scopedKey);
  if (existing !== null) {
    // Fail closed on a damaged or inaccessible store instead of replacing it.
    const parsed: unknown = JSON.parse(existing);
    if (!isVaultEnvelope(parsed)) throw new Error("Recovery storage is locked or damaged.");
    await decryptClaimableVaultValue(parsed, secret, scopedKey);
  }
  const envelope = await encryptClaimableVaultValue(value, secret, scopedKey);
  assertSession();
  if (window.localStorage.getItem(scopedKey) !== existing) {
    throw new Error("Recovery data changed in another tab. Reload and retry.");
  }
  window.localStorage.setItem(scopedKey, JSON.stringify(envelope));
}

export async function removeEncryptedLocalJson(storageKey: string): Promise<void> {
  if (typeof window === "undefined") return;
  const assertSession = assertClaimableVaultSession();
  assertSession();
  // Migrate an owned legacy envelope before removing only this account's store.
  const read = await readEncryptedLocalJson(storageKey);
  if (read.locked) throw new Error("Recovery storage is locked or damaged.");
  const scopedKey = await scopedStorageKey(storageKey, readCreatorVaultSecret());
  assertSession();
  window.localStorage.removeItem(scopedKey);
}

export function ensureTelegramMiniAppVaultSecret(): string {
  if (typeof window === "undefined") return "";
  const existing = window.sessionStorage.getItem(TELEGRAM_MINI_APP_VAULT_KEY)?.trim() ?? "";
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = bytesToBase64Url(bytes);
  window.sessionStorage.setItem(TELEGRAM_MINI_APP_VAULT_KEY, secret);
  return secret;
}

export function resolveClaimableVaultStorageKey(baseKey: string): string {
  if (typeof window === "undefined") return baseKey;
  const creatorToken = window.sessionStorage.getItem(CREATOR_TOKEN_STORAGE_KEY)?.trim() ?? "";
  if (creatorToken) return baseKey;
  const miniAppSecret = window.sessionStorage.getItem(TELEGRAM_MINI_APP_VAULT_KEY)?.trim() ?? "";
  return miniAppSecret ? `${baseKey}.telegram-mini-app` : baseKey;
}

export async function encryptClaimableVaultValue(
  value: unknown,
  secret: string,
  context: string,
): Promise<VaultEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(secret, salt, context);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: new TextEncoder().encode(context),
      iv,
      name: "AES-GCM",
    },
    key,
    plaintext,
  );

  return {
    algorithm: "AES-GCM",
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
    salt: bytesToBase64Url(salt),
    version: ENVELOPE_VERSION,
  };
}

export async function decryptClaimableVaultValue<T>(
  envelope: VaultEnvelope,
  secret: string,
  context: string,
): Promise<T> {
  const salt = base64UrlToBytes(envelope.salt);
  const iv = base64UrlToBytes(envelope.iv);
  const key = await deriveVaultKey(secret, salt, context);
  const plaintext = await crypto.subtle.decrypt(
    {
      additionalData: new TextEncoder().encode(context),
      iv: toArrayBuffer(iv),
      name: "AES-GCM",
    },
    key,
    toArrayBuffer(base64UrlToBytes(envelope.ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

function readCreatorVaultSecret(): string {
  try {
    return (
      window.sessionStorage.getItem(CREATOR_TOKEN_STORAGE_KEY)?.trim() ||
      window.sessionStorage.getItem(TELEGRAM_MINI_APP_VAULT_KEY)?.trim() ||
      ""
    );
  } catch {
    return "";
  }
}

async function deriveVaultKey(
  secret: string,
  salt: Uint8Array,
  context: string,
): Promise<CryptoKey> {
  if (!secret) throw new Error("Claimable vault secret is required.");
  const inputKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: new TextEncoder().encode(`Kaspa Links claimable vault:${context}`),
      name: "HKDF",
      salt: toArrayBuffer(salt),
    },
    inputKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

function isVaultEnvelope(value: unknown): value is VaultEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<VaultEnvelope>;
  return (
    candidate.algorithm === "AES-GCM" &&
    candidate.version === ENVELOPE_VERSION &&
    typeof candidate.ciphertext === "string" &&
    typeof candidate.iv === "string" &&
    typeof candidate.salt === "string"
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
