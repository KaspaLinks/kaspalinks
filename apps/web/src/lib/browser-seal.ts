// Encrypts secrets this browser keeps for links created without an account
// (manage tokens, claim links). The AES-GCM key is generated here, marked
// non-extractable and stored in IndexedDB, so a copy of the browser's stored
// data, or a page that only reads localStorage, sees ciphertext. Script running
// on this origin could still use the key; the page's nonce CSP is what keeps
// such script out.

const DB_NAME = "kaspa-links-keys";
const STORE_NAME = "keys";
const KEY_NAME = "account-free";
const SEAL_PREFIX = "seal1.";
const IV_BYTES = 12;

type KeyProvider = () => Promise<CryptoKey | null>;

let keyProvider: KeyProvider = loadBrowserSealKey;
let cachedKey: null | Promise<CryptoKey | null> = null;

export function setSealKeyProviderForTests(provider: KeyProvider | null): void {
  keyProvider = provider ?? loadBrowserSealKey;
  cachedKey = null;
}

function sealKey(): Promise<CryptoKey | null> {
  cachedKey ??= keyProvider().catch(() => null);
  return cachedKey;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadBrowserSealKey(): Promise<CryptoKey | null> {
  if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return null;
  // Generated before the transaction: an await inside it would let it commit early.
  const candidate = await crypto.subtle.generateKey({ length: 256, name: "AES-GCM" }, false, [
    "decrypt",
    "encrypt",
  ]);
  const database = await openDatabase();
  try {
    return await new Promise<CryptoKey>((resolve, reject) => {
      // One readwrite transaction, so two tabs cannot both store a different key.
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const lookup = store.get(KEY_NAME);
      lookup.onsuccess = () => {
        if (lookup.result instanceof CryptoKey) {
          resolve(lookup.result);
          return;
        }
        store.add(candidate, KEY_NAME).onsuccess = () => resolve(candidate);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Null when this browser cannot keep an encryption key (then nothing is stored). */
export async function sealSecret(plaintext: string): Promise<null | string> {
  const key = await sealKey();
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, new TextEncoder().encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv);
  packed.set(ciphertext, iv.length);
  return `${SEAL_PREFIX}${toBase64Url(packed)}`;
}

/** Null when the value cannot be opened here (other browser, lost key, tampered). */
export async function openSecret(sealed: string): Promise<null | string> {
  if (!sealed.startsWith(SEAL_PREFIX)) return null;
  const key = await sealKey();
  if (!key) return null;
  try {
    const packed = fromBase64Url(sealed.slice(SEAL_PREFIX.length));
    const plaintext = await crypto.subtle.decrypt(
      { iv: packed.slice(0, IV_BYTES), name: "AES-GCM" },
      key,
      packed.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
