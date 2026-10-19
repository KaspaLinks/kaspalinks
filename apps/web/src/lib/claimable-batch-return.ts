import { AuditActorType, prisma } from "@kaspa-actions/db";
import { buildToccataClaimableReturnSpend } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "./audit";
import { REGISTERED_TERMINAL_BATCH_CHILD_STATUSES } from "./batch-claimable-state";
import { parseStoredClaimableBatchOutputs } from "./claimable-batch-manifest";
import { defaultClaimableReturnDeps, type ClaimableReturnDeps } from "./claimable-return";
import { TOCCATA_CANARY_MIN_OUTPUT_SOMPI } from "./toccata-lab-fee";

// Keyless return for auto-return Claim Drops (scriptVersion 2). An allocator that
// was never activated may, after its lock time, only send its UTXO back to the
// committed return address. The server holds no key: anyone could broadcast it.
// Activated drops need nothing here; their children are v2 links that the link
// pass in claimable-return.ts returns one by one.

export type ReturnableClaimBatch = {
  activationTxId: null | string;
  creatorId: string;
  expectedOutputs: unknown;
  fundingAddress: string;
  fundingOutputIndex: null | number;
  fundingTxId: null | string;
  id: string;
  redeemScriptHex: string;
  refundLockTime: string;
  returnAddress: null | string;
  returnFeeSompi: bigint | null;
  scriptVersion: number;
  status: string;
};

export type ClaimBatchReturnOutcome =
  | { kind: "not_auto_return" }
  | { kind: "not_expired" }
  | { kind: "nothing_to_return" }
  | { kind: "returned"; transactionIds: string[] };

export type ClaimBatchReturnDeps = Pick<
  ClaimableReturnDeps,
  "broadcast" | "listUtxos" | "readDaaScore"
> & {
  markBatchReturned(input: {
    batch: ReturnableClaimBatch;
    fundingOutputIndex: number;
    fundingTransactionId: string;
    transactionId: string;
  }): Promise<void>;
};

export const defaultClaimBatchReturnDeps: ClaimBatchReturnDeps = {
  broadcast: defaultClaimableReturnDeps.broadcast,
  listUtxos: defaultClaimableReturnDeps.listUtxos,
  async markBatchReturned(input) {
    const linkKeys = parseStoredClaimableBatchOutputs(input.batch.expectedOutputs).map(
      (output) => output.linkKey,
    );
    const now = new Date();
    const [updated] = await prisma.$transaction([
      prisma.claimableBatch.updateMany({
        data: {
          fundingOutputIndex: input.fundingOutputIndex,
          fundingTxId: input.fundingTransactionId,
          pendingRefundTxId: null,
          refundTxId: input.transactionId,
          status: "refunded",
        },
        // Never overwrite an activation: then the children carry the KAS.
        where: { activationTxId: null, id: input.batch.id, status: { not: "activated" } },
      }),
      prisma.claimableLink.updateMany({
        data: { refundTxId: input.transactionId, refundedAt: now, status: "refunded" },
        where: {
          creatorId: input.batch.creatorId,
          fundingTxId: null,
          linkKey: { in: linkKeys },
          status: { notIn: [...REGISTERED_TERMINAL_BATCH_CHILD_STATUSES] },
        },
      }),
    ]);
    if (updated.count === 1) {
      await writeAuditLog(prisma, {
        actorType: AuditActorType.SYSTEM,
        creatorId: input.batch.creatorId,
        event: "claimable_batch.auto_returned",
        metadata: { batchId: input.batch.id, transactionId: input.transactionId },
      });
    }
  },
  readDaaScore: defaultClaimableReturnDeps.readDaaScore,
};

/**
 * Sends every UTXO still at an expired v2 allocator back to the return address,
 * one transaction each (the script allows a single input). Deterministic, so a
 * retry or a parallel worker re-broadcasts the identical transaction.
 */
export async function returnExpiredClaimBatch(
  batch: ReturnableClaimBatch,
  deps: ClaimBatchReturnDeps = defaultClaimBatchReturnDeps,
): Promise<ClaimBatchReturnOutcome> {
  if (batch.scriptVersion !== 2 || !batch.returnAddress || batch.returnFeeSompi === null) {
    return { kind: "not_auto_return" };
  }
  const feeSompi = batch.returnFeeSompi;
  if ((await deps.readDaaScore()) < BigInt(batch.refundLockTime)) return { kind: "not_expired" };

  // Dust below the reliable mainnet floor cannot pay for its own return.
  const utxos = (await deps.listUtxos(batch.fundingAddress)).filter(
    (utxo) => utxo.amountSompi - feeSompi >= TOCCATA_CANARY_MIN_OUTPUT_SOMPI,
  );
  if (utxos.length === 0) return { kind: "nothing_to_return" };

  const transactionIds: string[] = [];
  for (const utxo of utxos) {
    const spend = buildToccataClaimableReturnSpend({
      expectedFundingAddress: batch.fundingAddress,
      feeSompi,
      fundingAmountSompi: utxo.amountSompi,
      fundingOutputIndex: utxo.outputIndex,
      fundingTransactionId: utxo.transactionId,
      redeemScriptHex: batch.redeemScriptHex,
      refundLockTime: batch.refundLockTime,
      returnAddress: batch.returnAddress,
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

    // The first return closes an unactivated drop. Extra payments sent to an
    // activated allocator go back too, without touching its recorded state.
    if (
      transactionIds.length === 1 &&
      batch.activationTxId === null &&
      batch.status !== "activated" &&
      batch.status !== "refunded"
    ) {
      await deps.markBatchReturned({
        batch,
        fundingOutputIndex: utxo.outputIndex,
        fundingTransactionId: utxo.transactionId,
        transactionId,
      });
    }
  }

  return { kind: "returned", transactionIds };
}

const RETURN_RECHECK_MS = 5 * 60_000;
const RETURN_BATCH = 5;
const OPEN_BATCH_STATUSES = ["awaiting_funding", "funded"] as const;

export type ClaimBatchReturnTickResult = { checked: number; failed: number; returned: number };

/** One worker pass over expired, unactivated v2 Claim Drops (oldest check first). */
export async function processClaimBatchReturns(
  now: Date,
  currentDaaScore: bigint,
  deps: ClaimBatchReturnDeps = defaultClaimBatchReturnDeps,
): Promise<ClaimBatchReturnTickResult> {
  const result: ClaimBatchReturnTickResult = { checked: 0, failed: 0, returned: 0 };
  const pinnedDeps: ClaimBatchReturnDeps = { ...deps, readDaaScore: async () => currentDaaScore };

  const due = await prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
    SELECT id, "updatedAt"
    FROM "ClaimableBatch"
    WHERE "scriptVersion" = 2
      AND status IN (${OPEN_BATCH_STATUSES[0]}, ${OPEN_BATCH_STATUSES[1]})
      AND "activationTxId" IS NULL
      AND "refundLockTime" ~ '^[0-9]+$'
      AND "refundLockTime"::numeric <= ${currentDaaScore.toString()}::numeric
      AND "updatedAt" < ${new Date(now.getTime() - RETURN_RECHECK_MS)}
    ORDER BY "updatedAt" ASC
    LIMIT ${RETURN_BATCH}
  `;

  for (const row of due) {
    // Touch first so a parallel pass skips this drop.
    const claimed = await prisma.claimableBatch.updateMany({
      data: { updatedAt: now },
      where: { id: row.id, updatedAt: row.updatedAt },
    });
    if (claimed.count !== 1) continue;
    const batch = await prisma.claimableBatch.findUnique({ where: { id: row.id } });
    if (!batch) continue;
    result.checked += 1;
    try {
      const outcome = await returnExpiredClaimBatch(batch, pinnedDeps);
      if (outcome.kind === "returned") result.returned += 1;
    } catch (error) {
      result.failed += 1;
      console.error("[claimable-return] batch return failed", {
        batchId: batch.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  return result;
}

function isAlreadyAcceptedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already accepted|was already accepted by the consensus/i.test(message);
}
