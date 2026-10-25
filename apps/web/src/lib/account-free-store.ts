import { openSecret, sealSecret } from "./browser-seal";
import type { ClaimableStoreRecord } from "./claimable-store";

// Links this browser created without a KaspaLinks account. They live only here:
// the manage token (and, for claim links, the claim URL) is private and never
// stored on our servers. After signing in, the list can be moved into the account.
//
// Titles and amounts stay readable for the list; the secrets are sealed with a
// non-extractable browser key (browser-seal.ts). Entries written before sealing
// existed are sealed on their next read.

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

type Secrets = { claimUrl?: string; manageToken: string; vaultRecord?: ClaimableStoreRecord };

/** What the list shows without opening any secret. */
export type AccountFreeListing =
  | Omit<AccountFreeClaimEntry, "claimUrl" | "manageToken" | "vaultRecord">
  | Omit<AccountFreePaymentEntry, "manageToken">;

type StoredEntry = AccountFreeListing & { sealed: string };

function isListing(value: unknown): value is AccountFreeListing {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.title !== "string") return false;
  if (entry.kind === "payment") return typeof entry.publicId === "string";
  if (entry.kind === "claim") return typeof entry.linkKey === "string";
  return false;
}

function isSealed(value: AccountFreeListing): value is StoredEntry {
  return typeof (value as Partial<StoredEntry>).sealed === "string";
}

/** Written before sealing: the secrets sit in plain text next to the title. */
function isLegacy(value: AccountFreeListing): value is AccountFreeEntry {
  const entry = value as unknown as Record<string, unknown>;
  if (typeof entry.manageToken !== "string") return false;
  return entry.kind === "payment" || typeof entry.claimUrl === "string";
}

function readStored(): AccountFreeListing[] {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_FREE_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isListing).filter((entry) => isSealed(entry) || isLegacy(entry))
      : [];
  } catch {
    return [];
  }
}

function writeStored(entries: AccountFreeListing[]): boolean {
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

function entryId(entry: Pick<AccountFreeEntry, "kind"> & { linkKey?: string; publicId?: string }) {
  return entry.kind === "payment" ? `payment:${entry.publicId}` : `claim:${entry.linkKey}`;
}

/** Only the public fields; works for sealed, plain-text and full entries alike. */
function listingOf(entry: AccountFreeListing): AccountFreeListing {
  return entry.kind === "payment"
    ? {
        createdAt: entry.createdAt,
        kind: "payment",
        publicId: entry.publicId,
        title: entry.title,
        type: entry.type,
      }
    : {
        amountKas: entry.amountKas,
        createdAt: entry.createdAt,
        kind: "claim",
        linkKey: entry.linkKey,
        title: entry.title,
      };
}

async function seal(entry: AccountFreeEntry): Promise<null | StoredEntry> {
  const secrets: Secrets =
    entry.kind === "payment"
      ? { manageToken: entry.manageToken }
      : {
          claimUrl: entry.claimUrl,
          manageToken: entry.manageToken,
          vaultRecord: entry.vaultRecord,
        };
  const sealed = await sealSecret(JSON.stringify(secrets));
  return sealed ? { ...listingOf(entry), sealed } : null;
}

async function open(entry: StoredEntry): Promise<AccountFreeEntry | null> {
  const plaintext = await openSecret(entry.sealed);
  if (!plaintext) return null;
  try {
    const secrets = JSON.parse(plaintext) as Secrets;
    const listing = listingOf(entry);
    if (listing.kind === "payment") return { ...listing, manageToken: secrets.manageToken };
    if (typeof secrets.claimUrl !== "string") return null;
    return {
      ...listing,
      claimUrl: secrets.claimUrl,
      manageToken: secrets.manageToken,
      vaultRecord: secrets.vaultRecord,
    };
  } catch {
    return null;
  }
}

/** Titles, kinds and amounts only; no secret is opened. */
export function listAccountFreeEntries(): AccountFreeListing[] {
  return readStored().map(listingOf);
}

/** Opens every entry; plain-text entries from before sealing are sealed on the way. */
export async function readAccountFreeEntries(): Promise<AccountFreeEntry[]> {
  const stored = readStored();
  const entries: AccountFreeEntry[] = [];
  let migrated = false;
  const next: AccountFreeListing[] = [];
  for (const item of stored) {
    if (isSealed(item)) {
      const opened = await open(item);
      if (opened) entries.push(opened);
      next.push(item);
      continue;
    }
    if (isLegacy(item)) {
      entries.push(item);
      const sealed = await seal(item);
      next.push(sealed ?? item);
      migrated ||= sealed !== null;
    }
  }
  if (migrated) writeStored(next);
  return entries;
}

/** False when this browser cannot keep it; the private link on screen still works. */
export async function addAccountFreeEntry(entry: AccountFreeEntry): Promise<boolean> {
  const sealed = await seal(entry);
  if (!sealed) return false;
  const id = entryId(entry);
  return writeStored([sealed, ...readStored().filter((item) => entryId(item) !== id)]);
}

export function removeAccountFreeEntries(
  remove: (Pick<AccountFreeEntry, "kind"> & { linkKey?: string; publicId?: string })[],
): void {
  const ids = new Set(remove.map(entryId));
  writeStored(readStored().filter((item) => !ids.has(entryId(item))));
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
