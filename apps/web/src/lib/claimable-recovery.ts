import { z } from "zod";

import { formatSompiForToccataLab } from "./toccata-lab-fee";
import { deriveToccataLabKeyPair } from "./toccata-lab-keys";

const hex32Schema = z.string().regex(/^[0-9a-f]{64}$/i);
const positiveIntegerSchema = z.string().regex(/^[1-9][0-9]*$/);
const nonNegativeIntegerSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);

const fundingMatchSchema = z.object({
  amountSompi: positiveIntegerSchema,
  blockTime: z.number().int().nonnegative().nullable(),
  outputIndex: z.number().int().nonnegative(),
  transactionId: hex32Schema,
});

export const claimableRecoveryRecordSchema = z.object({
  amountKas: z.string().min(1).max(40),
  amountSompi: positiveIntegerSchema,
  claimPublicKey: hex32Schema,
  createdAt: z.string().datetime(),
  createdAtMs: z.number().int().positive(),
  description: z.string().max(180),
  feeKas: z.string().min(1).max(40),
  feeSompi: positiveIntegerSchema,
  fundingAddress: z.string().startsWith("kaspa:").max(128),
  fundingMatch: fundingMatchSchema.nullable(),
  id: z.string().min(1).max(120),
  netClaimKas: z.string().min(1).max(40),
  redeemScriptHex: z.string().regex(/^[0-9a-f]+$/i),
  refundCode: hex32Schema,
  refundLockTime: nonNegativeIntegerSchema,
  refundPublicKey: hex32Schema,
  status: z.enum([
    "awaiting_funding",
    "funded",
    "shared",
    "claimed",
    "refundable",
    "refunded",
    "spent_unknown",
  ]),
  title: z.string().min(1).max(80),
  validFor: z.string().min(1).max(80),
});

const claimableRecoveryBundleSchema = z.object({
  exportedAt: z.string().datetime(),
  format: z.literal("kaspalinks-claimable-link-recovery"),
  link: claimableRecoveryRecordSchema,
  version: z.literal(1),
  warning: z.string(),
});

export type ClaimableRecoveryRecord = z.infer<typeof claimableRecoveryRecordSchema>;
export type ClaimableRecoveryBundle = z.infer<typeof claimableRecoveryBundleSchema>;
export type ClaimableRecoveryTarget = { linkKey: string; title: string };

export function createClaimableRecoveryBundle(
  link: ClaimableRecoveryRecord,
  exportedAt = new Date().toISOString(),
): ClaimableRecoveryBundle {
  const validatedLink = claimableRecoveryRecordSchema.parse(link);
  assertClaimableRecoveryRecord(validatedLink);
  return {
    exportedAt,
    format: "kaspalinks-claimable-link-recovery",
    link: validatedLink,
    version: 1,
    warning:
      "PRIVATE REFUND DATA. Anyone with this file can refund the link after expiry. Never upload or share it.",
  };
}

export function parseClaimableRecoveryBundle(raw: string): ClaimableRecoveryBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Recovery file is not valid JSON.");
  }

  const result = claimableRecoveryBundleSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Recovery file has an invalid format.");
  }

  assertClaimableRecoveryRecord(result.data.link);
  return result.data;
}

export function buildClaimableRecoveryPath(linkKey: string, title = ""): string {
  const normalizedLinkKey = linkKey.trim();
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(normalizedLinkKey)) return "/claim/refund";
  const params = new URLSearchParams({ link: normalizedLinkKey });
  const normalizedTitle = title.trim().slice(0, 80);
  if (normalizedTitle) params.set("title", normalizedTitle);
  return `/claim/refund?${params.toString()}`;
}

export function readClaimableRecoveryTarget(search: string): ClaimableRecoveryTarget | null {
  const params = new URLSearchParams(search);
  const linkKey = params.get("link")?.trim() ?? "";
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(linkKey)) return null;
  return {
    linkKey,
    title: (params.get("title") ?? "").trim().slice(0, 80),
  };
}

export function assertClaimableMatchesRecoveryTarget(
  link: Pick<ClaimableRecoveryRecord, "id" | "title">,
  target: ClaimableRecoveryTarget | null,
): void {
  if (!target || link.id === target.linkKey) return;
  throw new Error(
    `This file belongs to “${link.title}”, not the claimable link selected in My Links.`,
  );
}

function assertClaimableRecoveryRecord(link: ClaimableRecoveryRecord): void {
  if (
    deriveToccataLabKeyPair(link.refundCode).xOnlyPublicKey !== link.refundPublicKey.toLowerCase()
  ) {
    throw new Error("Recovery file refund key does not match its public key.");
  }
  if (Date.parse(link.createdAt) !== link.createdAtMs) {
    throw new Error("Recovery file creation timestamp is inconsistent.");
  }

  const amount = BigInt(link.amountSompi);
  const fee = BigInt(link.feeSompi);
  if (fee <= 0n || fee >= amount) {
    throw new Error("Recovery file amount and fee are inconsistent.");
  }
  if (
    link.amountKas !== formatSompiForToccataLab(amount) ||
    link.feeKas !== formatSompiForToccataLab(fee) ||
    link.netClaimKas !== formatSompiForToccataLab(amount - fee)
  ) {
    throw new Error("Recovery file KAS amounts do not match its contract values.");
  }
  if (link.fundingMatch && link.fundingMatch.amountSompi !== link.amountSompi) {
    throw new Error("Recovery file funding amount is inconsistent.");
  }
  if (link.status === "awaiting_funding" && link.fundingMatch) {
    throw new Error("Recovery file funding state is inconsistent.");
  }
  if (
    link.status !== "awaiting_funding" &&
    !link.fundingMatch &&
    (link.status === "claimed" ||
      link.status === "refundable" ||
      link.status === "refunded" ||
      link.status === "spent_unknown")
  ) {
    throw new Error("Recovery file is missing its funding outpoint.");
  }
}
