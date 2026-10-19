import { GiveawayV6Phase, GiveawayV6TransitionKind, type PrismaClient } from "@kaspa-actions/db";
import { readKaspaVspcHeaders, type KaspaVspcRelayClient } from "@kaspa-actions/kaspa-indexer";

import type { GiveawayV6ProjectionRecord } from "./giveaway-v6-projection.ts";
import { restoreGiveawayV6Projection } from "./giveaway-v6-projection.ts";
import type { GiveawayV6EntropyProver } from "./giveaway-v6-prover.ts";
import {
  buildGiveawayV6DrawTransaction,
  buildGiveawayV6FreezeTransaction,
  buildGiveawayV6ReturnTransaction,
} from "./giveaway-v6-settlement.ts";

const DEFAULT_BATCH_SIZE = 2;
const LEASE_MS = 120_000;
const RELAY_RETRY_MS = 30_000;
const CONFIRMATION_POLL_MS = 5_000;
const SUBMISSION_RETRY_MS = 60_000;

const executorSelect = {
  id: true,
  giveawayId: true,
  network: true,
  covenantIdHex: true,
  anchorHash: true,
  config: true,
  family: true,
  checkpoint: true,
  phase: true,
  observedRegistrationCount: true,
  frozenEntryCount: true,
  winnerScriptPublicKeyHex: true,
  terminalTransactionId: true,
  cursorHash: true,
  lastPageFingerprint: true,
  syncRevision: true,
  executionLeaseRevision: true,
  giveaway: {
    select: {
      v6Bootstrap: {
        select: {
          fundingBlockDaaScore: true,
          prizeRedeemScriptHex: true,
          shardTemplateRedeemScriptHex: true,
        },
      },
    },
  },
} as const;

type ExecutorRecord = GiveawayV6ProjectionRecord & {
  executionLeaseRevision: number;
  giveaway: {
    v6Bootstrap: {
      fundingBlockDaaScore: bigint | null;
      prizeRedeemScriptHex: string;
      shardTemplateRedeemScriptHex: string;
    } | null;
  };
};

type PreparedDelivery = {
  kind: GiveawayV6TransitionKind;
  transactionId: string;
  transactionSafeJson: string;
};

export type GiveawayV6ExecutionSummary = {
  processed: number;
  submitted: number;
  waiting: number;
  failed: number;
  skipped: number;
};

/**
 * Runs the keyless terminal state machine. The worker can only submit the
 * transaction already constrained by SilverScript; it never receives a wallet
 * key, signature, claim secret, or refund secret.
 */
export async function executeDueGiveawayV6Settlements(
  prisma: PrismaClient,
  relay: KaspaVspcRelayClient,
  prover: GiveawayV6EntropyProver | null,
  now = new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<GiveawayV6ExecutionSummary> {
  const due = await prisma.giveawayV6Projection.findMany({
    orderBy: [{ executionNextAt: "asc" }, { createdAt: "asc" }],
    select: executorSelect,
    take: Math.min(Math.max(batchSize, 1), 5),
    where: {
      executionNextAt: { lte: now },
      phase: { in: [GiveawayV6Phase.OPEN, GiveawayV6Phase.FROZEN] },
    },
  });
  const summary: GiveawayV6ExecutionSummary = {
    processed: 0,
    submitted: 0,
    waiting: 0,
    failed: 0,
    skipped: 0,
  };
  for (const candidate of due) {
    const claimed = await prisma.giveawayV6Projection.updateMany({
      data: {
        executionLeaseRevision: { increment: 1 },
        executionNextAt: new Date(now.getTime() + LEASE_MS),
      },
      where: {
        executionLeaseRevision: candidate.executionLeaseRevision,
        executionNextAt: { lte: now },
        id: candidate.id,
      },
    });
    if (claimed.count !== 1) {
      summary.skipped += 1;
      continue;
    }
    const leaseRevision = candidate.executionLeaseRevision + 1;
    try {
      const outcome = await executeOne(prisma, relay, prover, candidate, now);
      await prisma.giveawayV6Projection.updateMany({
        data: {
          executionLastAttemptAt: now,
          executionLastErrorCode: outcome.errorCode,
          executionNextAt: outcome.nextAt,
        },
        where: { executionLeaseRevision: leaseRevision, id: candidate.id },
      });
      summary.processed += 1;
      summary[outcome.status] += 1;
    } catch (error) {
      const code = publicErrorCode(error);
      await prisma.giveawayV6Projection.updateMany({
        data: {
          executionLastAttemptAt: now,
          executionLastErrorCode: code,
          executionNextAt: retryable(code) ? new Date(now.getTime() + RELAY_RETRY_MS) : null,
        },
        where: { executionLeaseRevision: leaseRevision, id: candidate.id },
      });
      summary.failed += 1;
    }
  }
  return summary;
}

async function executeOne(
  prisma: PrismaClient,
  relay: KaspaVspcRelayClient,
  prover: GiveawayV6EntropyProver | null,
  record: ExecutorRecord,
  now: Date,
): Promise<{
  status: "submitted" | "waiting";
  errorCode: string | null;
  nextAt: Date;
}> {
  const restored = restoreGiveawayV6Projection(record);
  const bootstrap = record.giveaway.v6Bootstrap;
  if (!bootstrap || bootstrap.fundingBlockDaaScore === null) {
    throw coded("INVALID_BOOTSTRAP", "Giveaway V6 settlement bootstrap is incomplete.");
  }
  const cursorHash = restored.checkpoint?.cursorHash;
  if (!cursorHash) throw coded("PROJECTION_NOT_READY", "Giveaway V6 cursor is unavailable.");
  const [confirmedTip] = await readKaspaVspcHeaders(relay, [cursorHash]);
  if (!confirmedTip) throw coded("PROJECTION_NOT_READY", "Confirmed Giveaway V6 tip is missing.");
  const scripts = {
    prizeRedeemScriptHex: bootstrap.prizeRedeemScriptHex,
    shardTemplateRedeemScriptHex: bootstrap.shardTemplateRedeemScriptHex,
  };
  let prepared: PreparedDelivery;
  if (restored.snapshot.phase === "open") {
    if (confirmedTip.daaScore < restored.config.closesAtDaa) {
      return waiting(now, CONFIRMATION_POLL_MS, null);
    }
    const activation = restored.checkpoint?.transitions.find(
      (transition) => transition.event.kind === "activate",
    )?.event;
    if (!activation || activation.kind !== "activate") {
      throw coded("PROJECTION_NOT_READY", "Giveaway V6 activation is not projected.");
    }
    const transaction = buildGiveawayV6FreezeTransaction({
      activationBlockDaaScore: activation.blockDaaScore,
      config: restored.config,
      events: restored.checkpoint?.transitions.map((transition) => transition.event) ?? [],
      family: restored.family,
      scripts,
      snapshot: restored.snapshot,
    });
    prepared = {
      kind: GiveawayV6TransitionKind.FREEZE,
      transactionId: transaction.transactionId,
      transactionSafeJson: transaction.transactionSafeJson,
    };
  } else if (restored.snapshot.phase === "frozen") {
    const freeze = [...(restored.checkpoint?.transitions ?? [])]
      .reverse()
      .find((transition) => transition.event.kind === "freeze")?.event;
    if (!freeze || freeze.kind !== "freeze") {
      throw coded("PROJECTION_NOT_READY", "Giveaway V6 freeze is not projected.");
    }
    const fallbackDue = confirmedTip.daaScore >= restored.config.returnAtDaa;
    if (restored.snapshot.frozenEntryCount === 0 || fallbackDue) {
      const transaction = buildGiveawayV6ReturnTransaction({
        config: restored.config,
        family: restored.family,
        freezeBlockDaaScore: freeze.blockDaaScore,
        scripts,
        snapshot: restored.snapshot,
      });
      prepared = {
        kind: GiveawayV6TransitionKind.RETURN,
        transactionId: transaction.transactionId,
        transactionSafeJson: transaction.transactionSafeJson,
      };
    } else {
      if (confirmedTip.blueScore < restored.config.entropyTargetBlueScore) {
        return waiting(now, CONFIRMATION_POLL_MS, null);
      }
      if (!prover) return waiting(now, RELAY_RETRY_MS, "PROVER_NOT_CONFIGURED");
      let proof;
      try {
        proof = await prover.requestProof({ config: restored.config, snapshot: restored.snapshot });
      } catch {
        throw coded("PROVER_UNAVAILABLE", "Giveaway V6 entropy prover is unavailable.");
      }
      if (proof.status === "pending") {
        return waiting(now, proof.retryAfterSeconds * 1_000, "PROOF_PENDING");
      }
      const transaction = buildGiveawayV6DrawTransaction({
        compactProofHex: proof.compactProofHex,
        config: restored.config,
        entropy: proof.entropy,
        family: restored.family,
        freezeBlockDaaScore: freeze.blockDaaScore,
        scripts,
        snapshot: restored.snapshot,
      });
      prepared = {
        kind: GiveawayV6TransitionKind.DRAW,
        transactionId: transaction.transactionId,
        transactionSafeJson: transaction.transactionSafeJson,
      };
    }
  } else {
    return waiting(now, CONFIRMATION_POLL_MS, null);
  }

  const delivery = await persistDeliveryPlan(prisma, record.id, prepared);
  if (
    delivery.submittedAt &&
    delivery.submittedAt.getTime() + SUBMISSION_RETRY_MS > now.getTime()
  ) {
    return waiting(now, CONFIRMATION_POLL_MS, null);
  }
  try {
    await relay.submitTransaction({
      expectedTransactionId: prepared.transactionId,
      transactionSafeJson: prepared.transactionSafeJson,
    });
  } catch (error) {
    // The relay's reason is public chain feedback; keep it, or a stuck
    // settlement retries forever without saying why.
    console.warn("[giveaway-v6] settlement submit refused", {
      kind: prepared.kind,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      transactionId: prepared.transactionId,
    });
    await prisma.giveawayV6TransitionDelivery.update({
      data: {
        lastAttemptAt: now,
        lastErrorCode: "SETTLEMENT_RELAY_REJECTED",
      },
      where: { id: delivery.id },
    });
    throw coded("SETTLEMENT_RELAY_REJECTED", "Kaspa relay rejected the settlement.");
  }
  await prisma.giveawayV6TransitionDelivery.update({
    data: {
      lastAttemptAt: now,
      lastErrorCode: null,
      submittedAt: now,
    },
    where: { id: delivery.id },
  });
  return {
    status: "submitted",
    errorCode: null,
    nextAt: new Date(now.getTime() + CONFIRMATION_POLL_MS),
  };
}

async function persistDeliveryPlan(
  prisma: PrismaClient,
  projectionId: string,
  prepared: PreparedDelivery,
) {
  const delivery = await prisma.giveawayV6TransitionDelivery.upsert({
    create: {
      kind: prepared.kind,
      projectionId,
      transactionId: prepared.transactionId,
      transactionSafeJson: prepared.transactionSafeJson,
    },
    update: {},
    where: { transactionId: prepared.transactionId },
  });
  if (
    delivery.projectionId !== projectionId ||
    delivery.kind !== prepared.kind ||
    delivery.transactionSafeJson !== prepared.transactionSafeJson
  ) {
    throw coded("DELIVERY_PLAN_MISMATCH", "Stored Giveaway V6 delivery plan changed.");
  }
  return delivery;
}

function waiting(now: Date, milliseconds: number, errorCode: string | null) {
  return {
    status: "waiting" as const,
    errorCode,
    nextAt: new Date(now.getTime() + milliseconds),
  };
}

function coded(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function publicErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "SETTLEMENT_FAILED";
}

function retryable(code: string): boolean {
  return [
    "PROJECTION_NOT_READY",
    "PROVER_NOT_CONFIGURED",
    "PROVER_UNAVAILABLE",
    "PROOF_PENDING",
    "SETTLEMENT_RELAY_REJECTED",
    "VSPC_PARSE_ERROR",
    "VSPC_RPC_ERROR",
  ].includes(code);
}
