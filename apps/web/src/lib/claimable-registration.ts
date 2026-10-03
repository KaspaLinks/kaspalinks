import { Network } from "@kaspa-actions/db";
import { ZodError } from "zod";

import { isClaimableAutoReturnEnabled } from "./claimable-flags";
import { ErrorCodes, type ErrorCode } from "./errors";
import {
  ToccataLabSdkUnavailableError,
  validateRegisteredClaimableMetadata,
  type CanonicalClaimableMetadata,
} from "./toccata-lab";

// Shared by the creator route and the account-free route. Only non-secret
// metadata is ever registered: claim codes stay in the browser and URL fragments.

export type ClaimableLinkRow = {
  amountSompi: bigint;
  claimPublicKey: string;
  claimTxId: string | null;
  claimedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  description: string | null;
  feeSompi: bigint;
  fundingAddress: string;
  fundingOutputIndex: number | null;
  fundingTxId: string | null;
  id: string;
  linkKey: string;
  network: Network;
  redeemScriptHex: string;
  refundLockTime: string;
  refundPublicKey: string | null;
  refundTxId: string | null;
  refundedAt: Date | null;
  returnAddress: string | null;
  scriptVersion: number;
  status: string;
  title: string;
  updatedAt: Date;
};

export function serializeClaimableLink(link: ClaimableLinkRow) {
  return {
    id: link.id,
    linkKey: link.linkKey,
    title: link.title,
    description: link.description ?? "",
    amountSompi: link.amountSompi.toString(),
    feeSompi: link.feeSompi.toString(),
    fundingAddress: link.fundingAddress,
    claimPublicKey: link.claimPublicKey,
    refundPublicKey: link.refundPublicKey ?? "",
    refundLockTime: link.refundLockTime,
    redeemScriptHex: link.redeemScriptHex,
    returnAddress: link.returnAddress,
    scriptVersion: link.scriptVersion,
    fundingTxId: link.fundingTxId ?? null,
    fundingOutputIndex: link.fundingOutputIndex ?? null,
    claimTxId: link.claimTxId,
    claimedAt: link.claimedAt?.toISOString() ?? null,
    refundTxId: link.refundTxId,
    refundedAt: link.refundedAt?.toISOString() ?? null,
    status: link.status,
    network: link.network,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

export type ClaimableImmutableData = CanonicalClaimableMetadata & {
  description: string | null;
  network: Network;
  title: string;
};

export type ClaimableRegistrationResult =
  | { immutableData: ClaimableImmutableData; linkKey: string; ok: true }
  | { code: ErrorCode; message: string; ok: false; status: number };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function failure(status: number, code: ErrorCode, message: string): ClaimableRegistrationResult {
  return { code, message, ok: false, status };
}

/**
 * Parses and canonically validates a registration body. `requireAutoReturn`
 * is set for account-free links: without a creator session there is nobody to
 * hold a refund key, so only the keyless v2 script is accepted.
 */
export function parseClaimableRegistration(
  body: unknown,
  options: { requireAutoReturn?: boolean } = {},
): ClaimableRegistrationResult {
  if (typeof body !== "object" || body === null) {
    return failure(400, ErrorCodes.INVALID_BODY, "Invalid body.");
  }
  const b = body as Record<string, unknown>;
  const linkKey = str(b.linkKey);
  const title = str(b.title);
  const description = typeof b.description === "string" ? b.description.slice(0, 2000) : null;
  const scriptVersion = b.scriptVersion === 2 ? 2 : 1;

  if (!linkKey || linkKey.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(linkKey)) {
    return failure(400, ErrorCodes.INVALID_BODY, "linkKey is required.");
  }
  if (!title || title.length > 200) {
    return failure(400, ErrorCodes.INVALID_BODY, "title is required.");
  }
  if (options.requireAutoReturn && scriptVersion !== 2) {
    return failure(
      400,
      ErrorCodes.INVALID_BODY,
      "Links without an account must return unclaimed KAS automatically.",
    );
  }
  if (scriptVersion === 2 && !isClaimableAutoReturnEnabled()) {
    return failure(
      400,
      ErrorCodes.INVALID_BODY,
      "Auto-return claimable links are not enabled on this deployment.",
    );
  }

  let canonical: CanonicalClaimableMetadata;
  try {
    canonical = validateRegisteredClaimableMetadata({
      amountSompi: str(b.amountSompi),
      claimPublicKey: str(b.claimPublicKey),
      feeSompi: str(b.feeSompi),
      fundingAddress: str(b.fundingAddress),
      redeemScriptHex: str(b.redeemScriptHex),
      refundLockTime: str(b.refundLockTime),
      refundPublicKey: scriptVersion === 1 ? str(b.refundPublicKey) : null,
      returnAddress: scriptVersion === 2 ? str(b.returnAddress) : null,
      scriptVersion,
    });
  } catch (error) {
    if (error instanceof ToccataLabSdkUnavailableError) {
      return failure(503, ErrorCodes.SERVER_ERROR, "Claimable link validation is unavailable.");
    }
    const message =
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "Invalid claimable link metadata.")
        : error instanceof Error
          ? error.message
          : "Invalid claimable link metadata.";
    return failure(400, ErrorCodes.INVALID_BODY, message);
  }

  return {
    immutableData: { ...canonical, description, network: Network.MAINNET, title },
    linkKey,
    ok: true,
  };
}

export function sameImmutableClaimable(
  existing: ClaimableLinkRow,
  expected: ClaimableImmutableData,
): boolean {
  return (
    existing.amountSompi === expected.amountSompi &&
    existing.claimPublicKey === expected.claimPublicKey &&
    existing.description === expected.description &&
    existing.feeSompi === expected.feeSompi &&
    existing.fundingAddress === expected.fundingAddress &&
    existing.network === expected.network &&
    existing.redeemScriptHex === expected.redeemScriptHex &&
    existing.refundLockTime === expected.refundLockTime &&
    existing.refundPublicKey === expected.refundPublicKey &&
    existing.returnAddress === expected.returnAddress &&
    existing.scriptVersion === expected.scriptVersion &&
    existing.title === expected.title
  );
}
