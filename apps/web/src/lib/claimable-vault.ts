const CREATOR_TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
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

export async function readEncryptedLocalJson<T>(storageKey: string): Promise<EncryptedLocalRead<T>> {
  if (typeof window === "undefined") return { locked: false, value: null };
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return { locked: false, value: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { locked: false, value: null };
  }

  const secret = readCreatorVaultSecret();
  if (isVaultEnvelope(parsed)) {
    if (!secret) return { locked: true, value: null };
    try {
      return {
        locked: false,
        value: await decryptClaimableVaultValue<T>(parsed, secret, storageKey),
      };
    } catch {
      return { locked: true, value: null };
    }
  }

  // Migrate legacy plaintext only when the creator token is available. Never
  // destroy the old value merely because the vault is currently locked.
  if (secret) {
    await writeEncryptedLocalJson(storageKey, parsed).catch(() => undefined);
  }
  return { locked: false, value: parsed as T };
}

export async function writeEncryptedLocalJson(storageKey: string, value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  const secret = readCreatorVaultSecret();
  if (!secret) {
    throw new Error("Creator token is required to encrypt local claimable recovery data.");
  }
  const envelope = await encryptClaimableVaultValue(value, secret, storageKey);
  window.localStorage.setItem(storageKey, JSON.stringify(envelope));
}

export function removeEncryptedLocalJson(storageKey: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey);
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
    return window.sessionStorage.getItem(CREATOR_TOKEN_STORAGE_KEY)?.trim() ?? "";
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
