import {
  buildGiveawayV6ActivationTransaction,
  GiveawayV6BootstrapError,
  persistGiveawayV6ActivationFailure,
  persistGiveawayV6ActivationPlan,
  persistGiveawayV6ActivationSubmitted,
  persistGiveawayV6BootstrapBinding,
  prepareGiveawayV6BootstrapBinding,
} from "@kaspa-actions/application";
import {
  AuditActorType,
  GiveawayV6BootstrapStatus,
  GiveawayV6Phase,
  prisma,
} from "@kaspa-actions/db";

import { writeAuditLog } from "./audit";
import { readGiveawayV6ConfirmedFunding } from "./giveaway-v6-funding";
import { broadcastToccataGiveawayV6ActivationTransaction } from "./toccata-lab";

// Funding and activation used to advance only while the creator kept the
// studio open. The agent worker now asks for this pass every few seconds, so a
// funded giveaway goes live even if its tab was closed (and for guests, who may
// never come back). Same steps as the funding and activation routes; every
// step is keyless and guarded by status, so the studio and this pass can race.

const BATCH = 5;
const YOUNG_MS = 60 * 60_000;
const MAX_AGE_MS = 2 * 24 * 60 * 60_000;
const RECHECK_YOUNG_MS = 20_000;
const RECHECK_OLD_MS = 5 * 60_000;

const BOOTSTRAP_SELECT = {
  activationOutputs: true,
  activationSubmittedAt: true,
  activationTransactionId: true,
  compilerCommit: true,
  config: true,
  covenantIdHex: true,
  expectedFundingSompi: true,
  familyTerms: true,
  fundingAcceptingBlockHash: true,
  fundingAddress: true,
  fundingBlockDaaScore: true,
  fundingOutputIndex: true,
  fundingScriptPublicKeyHex: true,
  fundingTransactionId: true,
  giveaway: {
    select: { creatorId: true, publicId: true, v6Projection: { select: { phase: true } } },
  },
  giveawayId: true,
  id: true,
  network: true,
  prizeRedeemScriptHex: true,
  prizeSourceSha256: true,
  shardSourceSha256: true,
  shardTemplateRedeemScriptHex: true,
  status: true,
} as const;

type AdvanceRecord = NonNullable<Awaited<ReturnType<typeof loadBootstrap>>>;

export type GiveawayV6AdvanceResult = {
  activated: number;
  bound: number;
  checked: number;
  failed: number;
};

/** One pass over unfunded and funded-but-inactive Giveaway V6 bootstraps. */
export async function processUnattendedGiveawayV6Advances(
  now = new Date(),
): Promise<GiveawayV6AdvanceResult> {
  const result: GiveawayV6AdvanceResult = { activated: 0, bound: 0, checked: 0, failed: 0 };
  const at = now.getTime();
  const due = await prisma.giveawayV6Bootstrap.findMany({
    orderBy: { updatedAt: "asc" },
    select: { id: true, updatedAt: true },
    take: BATCH,
    where: {
      OR: [
        {
          createdAt: { gt: new Date(at - YOUNG_MS) },
          status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
          updatedAt: { lt: new Date(at - RECHECK_YOUNG_MS) },
        },
        {
          createdAt: { gt: new Date(at - MAX_AGE_MS), lte: new Date(at - YOUNG_MS) },
          status: GiveawayV6BootstrapStatus.AWAITING_FUNDING,
          updatedAt: { lt: new Date(at - RECHECK_OLD_MS) },
        },
        {
          activationSubmittedAt: null,
          giveaway: { v6Projection: { is: { phase: GiveawayV6Phase.AWAITING_ACTIVATION } } },
          status: GiveawayV6BootstrapStatus.BOUND,
          updatedAt: { lt: new Date(at - RECHECK_YOUNG_MS) },
        },
      ],
    },
  });

  for (const row of due) {
    // Touch first so a parallel pass skips this bootstrap.
    const claimed = await prisma.giveawayV6Bootstrap.updateMany({
      data: { updatedAt: now },
      where: { id: row.id, updatedAt: row.updatedAt },
    });
    if (claimed.count !== 1) continue;
    result.checked += 1;
    try {
      let record = await loadBootstrap(row.id);
      if (!record) continue;
      if (record.status === GiveawayV6BootstrapStatus.AWAITING_FUNDING) {
        if (!(await bindIfFunded(record))) continue;
        result.bound += 1;
        record = await loadBootstrap(row.id);
        if (!record) continue;
      }
      if (await activate(record)) result.activated += 1;
    } catch (error) {
      result.failed += 1;
      console.error("[giveaway-v6-advance] pass failed", {
        bootstrapId: row.id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }
  return result;
}

function loadBootstrap(id: string) {
  return prisma.giveawayV6Bootstrap.findUnique({ select: BOOTSTRAP_SELECT, where: { id } });
}

async function bindIfFunded(record: AdvanceRecord): Promise<boolean> {
  const lookup = await readGiveawayV6ConfirmedFunding({
    expectedFundingSompi: record.expectedFundingSompi,
    fundingAddress: record.fundingAddress,
    fundingScriptPublicKeyHex: record.fundingScriptPublicKeyHex,
  });
  if (lookup.status !== "confirmed") return false;

  const prepared = prepareGiveawayV6BootstrapBinding({ funding: lookup.funding, record });
  try {
    await persistGiveawayV6BootstrapBinding(prisma, record, prepared);
  } catch (error) {
    // The studio bound it a moment earlier; activation picks it up next pass.
    if (error instanceof GiveawayV6BootstrapError && error.code === "STALE_BOOTSTRAP") return false;
    throw error;
  }
  await writeAuditLog(prisma, {
    actorType: AuditActorType.SYSTEM,
    creatorId: record.giveaway.creatorId,
    event: "giveaway.v6_funding_bound",
    metadata: {
      covenantIdHex: prepared.family.covenantIdHex,
      fundingOutputIndex: lookup.funding.outputIndex,
      fundingTransactionId: lookup.funding.transactionId,
      publicId: record.giveaway.publicId,
      unattended: true,
    },
  });
  return true;
}

async function activate(record: AdvanceRecord): Promise<boolean> {
  if (
    record.status !== GiveawayV6BootstrapStatus.BOUND ||
    record.activationSubmittedAt !== null ||
    record.giveaway.v6Projection?.phase !== GiveawayV6Phase.AWAITING_ACTIVATION
  ) {
    return false;
  }
  const activation = buildGiveawayV6ActivationTransaction(record);
  await persistGiveawayV6ActivationPlan(prisma, record, activation.transactionId);

  const attemptedAt = new Date();
  let submittedTransactionId: string;
  try {
    const submitted = await broadcastToccataGiveawayV6ActivationTransaction({
      expectedTransactionId: activation.transactionId,
      transactionSafeJson: activation.transactionSafeJson,
    });
    submittedTransactionId = submitted.submittedTransactionId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/already (?:accepted|known)|transaction.*already/iu.test(message)) {
      submittedTransactionId = activation.transactionId;
    } else {
      await persistGiveawayV6ActivationFailure(
        prisma,
        record,
        activation.transactionId,
        attemptedAt,
        /rejected transaction|invalid transaction/iu.test(message)
          ? "ACTIVATION_RELAY_REJECTED"
          : "ACTIVATION_RELAY_UNAVAILABLE",
      ).catch(() => undefined);
      return false;
    }
  }
  if (submittedTransactionId.toLowerCase() !== activation.transactionId) {
    await persistGiveawayV6ActivationFailure(
      prisma,
      record,
      activation.transactionId,
      attemptedAt,
      "ACTIVATION_RELAY_REJECTED",
    ).catch(() => undefined);
    return false;
  }

  await persistGiveawayV6ActivationSubmitted(prisma, record, activation.transactionId, attemptedAt);
  await writeAuditLog(prisma, {
    actorType: AuditActorType.SYSTEM,
    creatorId: record.giveaway.creatorId,
    event: "giveaway.v6_activation_submitted",
    metadata: {
      covenantIdHex: activation.covenantIdHex,
      publicId: record.giveaway.publicId,
      transactionId: activation.transactionId,
      unattended: true,
    },
  });
  return true;
}
