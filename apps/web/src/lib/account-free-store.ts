import type { ClaimableStoreRecord } from "./claimable-store";

// Links this browser created without a KaspaLinks account. They live only here:
// the manage token (and, for claim links, the claim URL) is private and never
// stored on our servers. After signing in, the list can be moved into the account.

export const ACCOUNT_FREE_STORE_KEY = "kaspa-links:account-free-links";
export const ACCOUNT_FREE_STORE_EVENT = "kaspa-links:account-free-links-changed";
const MAX_ENTRIES = 100;

export type AccountFreePaymentEntry = {
  createdAt: string;
  kind: "payment";
  manageToken: string;
  publicId: string;
  title: string;
  type: string;
};

export type AccountFreeClaimEntry = {
  amountKas: string;
  /** Contains the claim code in its fragment; whoever has it can claim the KAS. */
  claimUrl: string;
  createdAt: string;
  kind: "claim";
  linkKey: string;
  manageToken: string;
  title: string;
  /** Written to the account's encrypted vault on adoption, so My Links shows the claim link. */
  vaultRecord?: ClaimableStoreRecord;
};

export type AccountFreeEntry = AccountFreeClaimEntry | AccountFreePaymentEntry;

function isEntry(value: unknown): value is AccountFreeEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.manageToken !== "string" || typeof entry.title !== "string") return false;
  if (entry.kind === "payment") return typeof entry.publicId === "string";
  if (entry.kind === "claim") {
    return typeof entry.linkKey === "string" && typeof entry.claimUrl === "string";
  }
  return false;
}

export function readAccountFreeEntries(): AccountFreeEntry[] {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_FREE_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function writeEntries(entries: AccountFreeEntry[]): boolean {
  try {
    window.localStorage.setItem(
      ACCOUNT_FREE_STORE_KEY,
      JSON.stringify(entries.slice(0, MAX_ENTRIES)),
    );
    window.dispatchEvent(new Event(ACCOUNT_FREE_STORE_EVENT));
    return true;
  } catch {
    // Private mode or full storage: the manage link shown on screen still works.
    return false;
  }
}

function entryId(entry: AccountFreeEntry): string {
  return entry.kind === "payment" ? `payment:${entry.publicId}` : `claim:${entry.linkKey}`;
}

export function addAccountFreeEntry(entry: AccountFreeEntry): boolean {
  const id = entryId(entry);
  return writeEntries([entry, ...readAccountFreeEntries().filter((item) => entryId(item) !== id)]);
}

export function removeAccountFreeEntries(remove: AccountFreeEntry[]): void {
  const ids = new Set(remove.map(entryId));
  writeEntries(readAccountFreeEntries().filter((item) => !ids.has(entryId(item))));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 random bytes as 43 base64url characters; the server only learns its SHA-256. */
export function createManageToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashManageTokenInBrowser(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildManageUrl(origin: string, publicId: string, manageToken: string): string {
  return `${origin}/manage/${encodeURIComponent(publicId)}#token=${encodeURIComponent(manageToken)}`;
}
