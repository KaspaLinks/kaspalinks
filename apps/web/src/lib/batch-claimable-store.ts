import { batchRecordSchema, type BatchRecoveryRecord } from "./batch-claimable-recovery";
import { encodeClaimableFragmentPayload } from "./claimable-share";
import {
  loadClaimableRecords,
  removeClaimableRecord,
  saveClaimableRecord,
  type ClaimableStoreRecord,
} from "./claimable-store";
import { readEncryptedLocalJson } from "./claimable-vault";

export const BATCH_CLAIMABLE_STORAGE_KEY = "kaspalinks.claimable-batch-lab.v1";

type BatchLink = BatchRecoveryRecord["links"][number];

function browserOrigin(origin?: string): string {
  if (origin) return origin;
  return typeof window === "undefined" ? "https://kaspalinks.com" : window.location.origin;
}

export function buildBatchClaimUrl(
  link: BatchLink,
  batch: BatchRecoveryRecord,
  origin?: string,
): string {
  if (!link.fundingMatch) return "";
  return `${browserOrigin(origin)}/claim?link=${encodeURIComponent(link.id)}#lab-claim=${encodeClaimableFragmentPayload(
    {
      amountKas: link.amountKas,
      amountSompi: link.amountSompi,
      claimCode: link.claimCode,
      claimPublicKey: link.claimPublicKey,
      createdAt: batch.createdAt,
      createdAtMs: batch.createdAtMs,
      description: link.description,
      feeKas: link.feeKas,
      feeSompi: link.feeSompi,
      fundingAddress: link.fundingAddress,
      fundingMatch: link.fundingMatch,
      id: link.id,
      netClaimKas: link.netClaimKas,
      redeemScriptHex: link.redeemScriptHex,
      refundLockTime: link.refundLockTime,
      title: link.title,
      validFor: batch.validFor,
      version: 1,
    },
  )}`;
}

export function buildBatchRefundUrl(
  link: BatchLink,
  batch: BatchRecoveryRecord,
  origin?: string,
): string {
  if (!link.fundingMatch) return "";
  return `${browserOrigin(origin)}/claim/refund#lab-manage=${encodeClaimableFragmentPayload({
    amountKas: link.amountKas,
    amountSompi: link.amountSompi,
    createdAt: batch.createdAt,
    createdAtMs: batch.createdAtMs,
    description: link.description,
    feeKas: link.feeKas,
    feeSompi: link.feeSompi,
    fundingAddress: link.fundingAddress,
    fundingMatch: link.fundingMatch,
    id: link.id,
    netClaimKas: link.netClaimKas,
    redeemScriptHex: link.redeemScriptHex,
    refundCode: link.refundCode,
    refundLockTime: link.refundLockTime,
    refundPublicKey: link.refundPublicKey,
    title: link.title,
    validFor: batch.validFor,
    version: 1,
  })}`;
}

export function toBatchClaimableStoreRecord(
  link: BatchLink,
  batch: BatchRecoveryRecord,
  origin?: string,
): ClaimableStoreRecord | null {
  if (!link.fundingMatch || link.deletedAt) return null;

  return {
    amountKas: link.amountKas,
    claimCode: link.claimCode,
    claimUrl: buildBatchClaimUrl(link, batch, origin),
    createdAt: batch.createdAt,
    createdAtMs: batch.createdAtMs,
    description: link.description,
    feeKas: link.feeKas,
    fundingAddress: link.fundingAddress,
    id: link.id,
    manageUrl: buildBatchRefundUrl(link, batch, origin),
    netClaimKas: link.netClaimKas,
    refundCode: link.refundCode,
    refundLockTime: link.refundLockTime,
    status:
      link.status === "spent"
        ? "spent_unknown"
        : link.status === "awaiting_activation"
          ? "funded"
          : link.status,
    title: link.title,
    updatedAtMs: Date.now(),
    validFor: batch.validFor,
  };
}

export async function saveBatchLinksToMyLinks(
  batch: BatchRecoveryRecord,
): Promise<ClaimableStoreRecord[]> {
  for (const link of batch.links) {
    if (link.deletedAt) await removeClaimableRecord(link.id);
  }

  const records = batch.links
    .map((link) => toBatchClaimableStoreRecord(link, batch))
    .filter((record): record is ClaimableStoreRecord => record !== null);

  for (const record of records) await saveClaimableRecord(record);
  return records;
}

export async function restoreCurrentBatchLinksToMyLinks(): Promise<number> {
  const stored = await readEncryptedLocalJson<unknown>(BATCH_CLAIMABLE_STORAGE_KEY);
  const parsed = batchRecordSchema.safeParse(stored.value);
  if (!parsed.success || parsed.data.activation.status !== "activated") return 0;

  const existing = new Map((await loadClaimableRecords()).map((record) => [record.id, record]));
  const missing = parsed.data.links.filter((link) => {
    const record = existing.get(link.id);
    return !record?.claimUrl || !record.manageUrl;
  });
  if (missing.length === 0) return 0;

  const repairedBatch = { ...parsed.data, links: missing };
  return (await saveBatchLinksToMyLinks(repairedBatch)).length;
}
