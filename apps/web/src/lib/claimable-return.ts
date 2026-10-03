import { AuditActorType, prisma } from "@kaspa-actions/db";
import { buildToccataClaimableReturnSpend } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "./audit";
import {
  listClaimableFundingUtxos,
  readCurrentMainnetDaaScore,
  type ClaimableFundingUtxo,
} from "./claimable-onchain";
import { broadcastToccataPreparedTransaction } from "./toccata-lab";
import { TOCCATA_CANARY_MIN_OUTPUT_SOMPI } from "./toccata-lab-fee";

// Keyless auto-return for v2 claimable links (docs/adr/0007). The server holds no
// key here: the script itself only lets an expired output go to the committed
// return address, so anyone, including this server, may broadcast the return.

export const CLOSED_CLAIMABLE_STATUSES = ["claimed", "refunded", "spent_unknown"] as const;
const CLOSED = new Set<string>(CLOSED_CLAIMABLE_STATUSES);

export type ReturnableClaimableLink = {
  amountSompi: bigint;
  feeSompi: bigint;
  fundingAddress: string;
  fundingOutputIndex: null | number;
  fundingTxId: null | string;
  id: string;
  redeemScriptHex: string;
  refundLockTime: string;
  returnAddress: null | string;
  scriptVersion: number;
  status: string;
};

export type ClaimableReturnOutcome =
  | { kind: "not_auto_return" }
  | { currentDaaScore: string; kind: "not_expired"; refundLockTime: string }
  | { kind: "nothing_to_return" }
  | { kind: "returned"; transactionIds: string[] };

export type ClaimableReturnDeps = {
  broadcast(input: {
    expectedTransactionId: string;
    transactionSafeJson: string;
  }): Promise<{ submittedTransactionId: string }>;
  listUtxos(fundingAddress: string): Promise<ClaimableFundingUtxo[]>;
  markReturned(input: {
    fundingOutputIndex: number;
    fundingTransactionId: string;
    linkId: string;
    transactionId: string;
  }): Promise<void>;
  readDaaScore(): Promise<bigint>;
};

export const defaultClaimableReturnDeps: ClaimableReturnDeps = {
  broadcast: (input) => broadcastToccataPreparedTransaction(input),
  listUtxos: listClaimableFundingUtxos,
  async markReturned(input) {
    const updated = await prisma.claimableLink.updateMany({
      data: {
        fundingOutputIndex: input.fundingOutputIndex,
        fundingTxId: input.fundingTransactionId,
        refundedAt: new Date(),
        refundTxId: input.transactionId,
        status: "refunded",
      },
      where: { id: input.linkId, status: { notIn: [...CLOSED_CLAIMABLE_STATUSES] } },
    });
    if (updated.count === 1) {
      await writeAuditLog(prisma, {
        actorType: AuditActorType.SYSTEM,
        event: "claimable_link.auto_returned",
        metadata: { linkId: input.linkId, transactionId: input.transactionId },
      });
    }
  },
  readDaaScore: readCurrentMainnetDaaScore,
};

/**
 * Sends every UTXO still sitting at an expired v2 link's address back to its
 * return address, one transaction each. Keyless transactions are deterministic,
 * so a retry (or a parallel worker) re-broadcasts the identical transaction.
 */
export async function returnExpiredClaimable(
  link: ReturnableClaimableLink,
  deps: ClaimableReturnDeps = defaultClaimableReturnDeps,
): Promise<ClaimableReturnOutcome> {
  if (link.scriptVersion !== 2 || !link.returnAddress) return { kind: "not_auto_return" };

  const currentDaaScore = await deps.readDaaScore();
  if (currentDaaScore < BigInt(link.refundLockTime)) {
    return {
      currentDaaScore: currentDaaScore.toString(),
      kind: "not_expired",
      refundLockTime: link.refundLockTime,
    };
  }

  // Dust below the reliable mainnet floor cannot pay for its own return.
  const utxos = (await deps.listUtxos(link.fundingAddress)).filter(
    (utxo) => utxo.amountSompi - link.feeSompi >= TOCCATA_CANARY_MIN_OUTPUT_SOMPI,
  );
  if (utxos.length === 0) return { kind: "nothing_to_return" };

  const transactionIds: string[] = [];
  for (const utxo of orderPrimaryFirst(utxos, link)) {
    const spend = buildToccataClaimableReturnSpend({
      expectedFundingAddress: link.fundingAddress,
      feeSompi: link.feeSompi,
      fundingAmountSompi: utxo.amountSompi,
      fundingOutputIndex: utxo.outputIndex,
      fundingTransactionId: utxo.transactionId,
      redeemScriptHex: link.redeemScriptHex,
      refundLockTime: link.refundLockTime,
      returnAddress: link.returnAddress,
    });

    let transactionId: string;
    try {
      const result = await deps.broadcast({
        expectedTransactionId: spend.transactionId,
        transactionSafeJson: spend.transactionSafeJson,
      });
      transactionId = result.submittedTransactionId;
    } catch (error) {
      if (!isAlreadyAcceptedError(error)) throw error;
      transactionId = spend.transactionId;
    }
    transactionIds.push(transactionId);

    if (transactionIds.length === 1 && !CLOSED.has(link.status)) {
      await deps.markReturned({
        fundingOutputIndex: utxo.outputIndex,
        fundingTransactionId: utxo.transactionId,
        linkId: link.id,
        transactionId,
      });
    }
  }

  return { kind: "returned", transactionIds };
}

const RETURN_RECHECK_MS = 5 * 60_000;
const RETURN_BATCH = 10;
const CLEANUP_BATCH = 5;
// ~7 days of DAA score at ten blocks per second.
const UNFUNDED_CLEANUP_DAA_DELAY = 7n * 24n * 60n * 60n * 10n;
const OPEN_STATUSES = ["awaiting_funding", "funded", "shared", "refundable"];

export type ClaimableReturnTickResult = {
  checked: number;
  deletedUnfunded: number;
  failed: number;
  returned: number;
};

/**
 * One worker pass: returns expired v2 links (oldest check first) and deletes
 * anonymous links that were never funded, once their address is verifiably
 * empty a week after expiry. A row is only deleted when nothing is left that
 * would need its redeem script.
 */
export async function processClaimableReturns(
  now: Date,
  deps: ClaimableReturnDeps = defaultClaimableReturnDeps,
): Promise<ClaimableReturnTickResult> {
  const result: ClaimableReturnTickResult = {
    checked: 0,
    deletedUnfunded: 0,
    failed: 0,
    returned: 0,
  };
  const currentDaaScore = await deps.readDaaScore();
  const pinnedDeps: ClaimableReturnDeps = { ...deps, readDaaScore: async () => currentDaaScore };

  const due = await prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
    SELECT id, "updatedAt"
    FROM "ClaimableLink"
    WHERE "scriptVersion" = 2
      AND status IN (${OPEN_STATUSES[0]}, ${OPEN_STATUSES[1]}, ${OPEN_STATUSES[2]}, ${OPEN_STATUSES[3]})
      AND "refundLockTime" ~ '^[0-9]+$'
      AND "refundLockTime"::numeric <= ${currentDaaScore.toString()}::numeric
      AND "updatedAt" < ${new Date(now.getTime() - RETURN_RECHECK_MS)}
    ORDER BY "updatedAt" ASC
    LIMIT ${RETURN_BATCH}
  `;

  for (const row of due) {
    // Touch first so a parallel pass skips this link.
    const claimed = await prisma.claimableLink.updateMany({
      data: { updatedAt: now },
      where: { id: row.id, updatedAt: row.updatedAt },
    });
    if (claimed.count !== 1) continue;
    const link = await prisma.claimableLink.findUnique({ where: { id: row.id } });
    if (!link) continue;
    result.checked += 1;
    try {
      const outcome = await returnExpiredClaimable(link, pinnedDeps);
      if (outcome.kind === "returned") result.returned += 1;
    } catch (error) {
      result.failed += 1;
      console.error("[claimable-return] return failed", {
        linkId: link.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  const cleanupCutoff = currentDaaScore - UNFUNDED_CLEANUP_DAA_DELAY;
  if (cleanupCutoff > 0n) {
    const stale = await prisma.$queryRaw<Array<{ fundingAddress: string; id: string }>>`
      SELECT id, "fundingAddress"
      FROM "ClaimableLink"
      WHERE "creatorId" IS NULL
        AND "scriptVersion" = 2
        AND status = 'awaiting_funding'
        AND "fundingTxId" IS NULL
        AND "refundLockTime" ~ '^[0-9]+$'
        AND "refundLockTime"::numeric <= ${cleanupCutoff.toString()}::numeric
      ORDER BY "createdAt" ASC
      LIMIT ${CLEANUP_BATCH}
    `;
    for (const row of stale) {
      try {
        if ((await deps.listUtxos(row.fundingAddress)).length > 0) continue;
        const deleted = await prisma.claimableLink.deleteMany({
          where: { creatorId: null, fundingTxId: null, id: row.id, status: "awaiting_funding" },
        });
        result.deletedUnfunded += deleted.count;
      } catch {
        // A failed lookup never proves emptiness; try again next pass.
      }
    }
  }

  return result;
}

/** The registered funding output (or the exact planned amount) is recorded as the return. */
function orderPrimaryFirst(
  utxos: ClaimableFundingUtxo[],
  link: ReturnableClaimableLink,
): ClaimableFundingUtxo[] {
  const rank = (utxo: ClaimableFundingUtxo) => {
    if (
      link.fundingTxId !== null &&
      utxo.transactionId === link.fundingTxId.toLowerCase() &&
      utxo.outputIndex === link.fundingOutputIndex
    ) {
      return 0;
    }
    return utxo.amountSompi === link.amountSompi ? 1 : 2;
  };
  return [...utxos].sort((left, right) => rank(left) - rank(right));
}

function isAlreadyAcceptedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already accepted|was already accepted by the consensus/i.test(message);
}
