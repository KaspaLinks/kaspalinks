// Client-only encrypted recovery store. Claim/manage URLs carry bearer secrets
// and are encrypted with key material derived from the creator token before
// localStorage sees them. The token itself remains sessionStorage-only.

import {
  assertClaimableVaultSession,
  readEncryptedLocalJson,
  resolveClaimableVaultStorageKey,
  writeEncryptedLocalJson,
} from "./claimable-vault";

export type ClaimableStoreRecord = {
  id: string;
  title: string;
  description: string;
  amountKas: string;
  netClaimKas: string;
  feeKas: string;
  fundingAddress: string;
  refundLockTime: string;
  validFor: string;
  status: string;
  createdAt: string;
  createdAtMs: number;
  claimUrl: string;
  manageUrl: string;
  // Encrypted by claimable-vault before localStorage. Keeping the raw browser
  // keys here allows recovery URLs to be rebuilt after a render interruption.
  claimCode?: string;
  refundCode?: string;
  // Explicit creator consent for preparing a fixed-destination winner claim.
  // This flag is encrypted with the local record and grants the server no key.
  giveawayAutoPrepareEnabled?: boolean;
  // Legacy local preference retained so existing encrypted stores remain
  // readable while the Giveaway Lab migrates from direct payout to claims.
  giveawayAutoPayoutEnabled?: boolean;
  giveawayPublicId?: string;
  recoveryBackupSkippedAt?: string;
  recoveryExportedAt?: string;
  updatedAtMs: number;
};

const STORAGE_KEY = "kaspalinks.claimable.v1";
let writeQueue: Promise<void> = Promise.resolve();

function isStoreRecord(value: unknown): value is ClaimableStoreRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string"
  );
}

export async function loadClaimableRecords(): Promise<ClaimableStoreRecord[]> {
  await writeQueue;
  return readRecords();
}

async function readRecords(): Promise<ClaimableStoreRecord[]> {
  const result = await readEncryptedLocalJson<unknown>(
    resolveClaimableVaultStorageKey(STORAGE_KEY),
  );
  if (result.locked)
    throw new Error("Recovery storage is locked or damaged. Restore your backup before saving.");
  if (!Array.isArray(result.value)) return [];
  return result.value.filter(isStoreRecord).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export function saveClaimableRecord(record: ClaimableStoreRecord): Promise<ClaimableStoreRecord[]> {
  return enqueueWrite(async () => {
    const assertSession = assertClaimableVaultSession();
    const records = await readRecords();
    assertSession();
    const index = records.findIndex((entry) => entry.id === record.id);
    if (index >= 0) {
      records[index] = { ...records[index], ...record };
    } else {
      records.push(record);
    }
    const sorted = records.sort((a, b) => b.createdAtMs - a.createdAtMs);
    await writeEncryptedLocalJson(resolveClaimableVaultStorageKey(STORAGE_KEY), sorted);
    return sorted;
  });
}

export function removeClaimableRecord(id: string): Promise<ClaimableStoreRecord[]> {
  return enqueueWrite(async () => {
    const assertSession = assertClaimableVaultSession();
    const records = (await readRecords()).filter((entry) => entry.id !== id);
    assertSession();
    await writeEncryptedLocalJson(resolveClaimableVaultStorageKey(STORAGE_KEY), records);
    return records;
  });
}

export function updateClaimableStatus(id: string, status: string): Promise<ClaimableStoreRecord[]> {
  return enqueueWrite(async () => {
    const assertSession = assertClaimableVaultSession();
    const records = await readRecords();
    assertSession();
    if (!records.some((entry) => entry.id === id)) return records;
    const updated = records.map((entry) =>
      entry.id === id ? { ...entry, status, updatedAtMs: Date.now() } : entry,
    );
    await writeEncryptedLocalJson(resolveClaimableVaultStorageKey(STORAGE_KEY), updated);
    return updated;
  });
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const assertSession = assertClaimableVaultSession();
  const guarded = async () => {
    assertSession();
    const run = async () => {
      assertSession();
      return operation();
    };
    return typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(STORAGE_KEY, run)
      : run();
  };
  const result = writeQueue.then(guarded, guarded);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
