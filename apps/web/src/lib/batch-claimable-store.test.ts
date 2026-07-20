import { afterEach, describe, expect, it, vi } from "vitest";

import type { BatchRecoveryRecord } from "./batch-claimable-recovery";
import {
  BATCH_CLAIMABLE_STORAGE_KEY,
  restoreCurrentBatchLinksToMyLinks,
  toBatchClaimableStoreRecord,
} from "./batch-claimable-store";
import { loadClaimableRecords } from "./claimable-store";
import { writeEncryptedLocalJson } from "./claimable-vault";

describe("batch claimable My Links store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds private claim and refund URLs for an activated child", () => {
    const batch = activatedBatch();
    const record = toBatchClaimableStoreRecord(batch.links[0]!, batch, "https://kaspalinks.com");

    expect(record?.claimUrl).toContain("/claim?link=batch-share-1#lab-claim=");
    expect(record?.manageUrl).toContain("/claim/refund#lab-manage=");
    expect(record?.claimCode).toBe("1".repeat(64));
    expect(record?.refundCode).toBe("3".repeat(64));
  });

  it("repairs missing My Links records from the encrypted current batch", async () => {
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage({
      "kaspa-actions:creator-token": "ka_creator_batch-repair",
    });
    vi.stubGlobal("window", {
      localStorage,
      location: { origin: "https://kaspalinks.com" },
      sessionStorage,
    });

    await writeEncryptedLocalJson(BATCH_CLAIMABLE_STORAGE_KEY, activatedBatch());
    expect(localStorage.getItem(BATCH_CLAIMABLE_STORAGE_KEY)).not.toContain("claimCode");

    await expect(restoreCurrentBatchLinksToMyLinks()).resolves.toBe(2);
    const records = await loadClaimableRecords();
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.claimUrl.includes("#lab-claim="))).toBe(true);
    await expect(restoreCurrentBatchLinksToMyLinks()).resolves.toBe(0);
  });
});

function activatedBatch(): BatchRecoveryRecord {
  const createdAt = "2026-07-20T18:00:00.000Z";
  const link = (index: number): BatchRecoveryRecord["links"][number] => ({
    amountKas: "1.002",
    amountSompi: "100200000",
    claimCode: String(index).repeat(64),
    claimPublicKey: String(index + 1).repeat(64),
    description: "Community reward",
    feeKas: "0.002",
    feeSompi: "200000",
    fundingAddress: `kaspa:${"q".repeat(61)}`,
    fundingMatch: {
      amountSompi: "100200000",
      blockTime: null,
      outputIndex: index - 1,
      transactionId: "a".repeat(64),
    },
    id: `batch-share-${index}`,
    netClaimKas: "1",
    redeemScriptHex: "aa",
    refundCode: String(index + 2).repeat(64),
    refundLockTime: "123456",
    refundPublicKey: String(index + 3).repeat(64),
    scriptPublicKeyHex: "00aa",
    status: "funded",
    title: `Reward ${index}`,
  });

  return {
    activation: {
      activationCode: "5".repeat(64),
      activationFeeSompi: "1000000",
      activationPublicKey: "6".repeat(64),
      fundingAddress: `kaspa:${"q".repeat(61)}`,
      fundingAmountSompi: "201400000",
      fundingMatch: {
        amountSompi: "201400000",
        blockTime: null,
        outputIndex: 0,
        transactionId: "b".repeat(64),
      },
      redeemScriptHex: "aa",
      refundCode: "7".repeat(64),
      refundPublicKey: "8".repeat(64),
      status: "activated",
    },
    batchManifestRegisteredAt: createdAt,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    id: "batch-share",
    links: [link(1), link(2)],
    title: "Community drop",
    validFor: "24 hours",
    version: 2,
  };
}

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
