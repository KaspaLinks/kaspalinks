import {
  ActionType,
  AuditActorType,
  NotificationRuleStatus,
  PaymentRequestStatus,
  Prisma,
  type PaymentRequest,
  type PrismaClient,
} from "@kaspa-actions/db";
import type {
  KaspaIndexer,
  KaspaIndexerIncomingPayment,
  KaspaIndexerMatch,
} from "@kaspa-actions/kaspa-indexer";

import { notificationRuleMatches } from "./rules.ts";

const INDEXER_COOLDOWN_MS = 1_500;
const lastProbeAt = new Map<string, number>();

export type ChainConfirmContext = {
  ipHash?: null | string;
  reportedTxId?: null | string;
};

export type ChainConfirmResult =
  | { kind: "confirmed"; paymentRequest: PaymentRequest }
  | { kind: "error"; reason: string }
  | { kind: "ambiguous" }
  | { kind: "no_match" }
  | { kind: "skipped" };

type PaymentConfirmationInput = {
  blockTime?: number | null;
  amountSompi: bigint;
  auditEvent: string;
  auditMetadata: Prisma.InputJsonObject;
  confirmedAt: Date;
  detectionSource: string;
  fakeTxId?: string;
  ipHash: null | string;
  notify: boolean;
  transactionId: string;
};

export function nextDetectionDelayMs(attempt: number): number {
  if (attempt < 5) return 3_000;
  return Math.min(30_000, 3_000 * 2 ** Math.min(attempt - 4, 4));
}

export async function scheduleNextPaymentDetection(
  prisma: PrismaClient,
  paymentRequestId: string,
  attempt: number,
  now = new Date(),
) {
  return prisma.paymentRequest.updateMany({
    data: {
      detectionAttempts: attempt,
      nextDetectionAt: new Date(now.getTime() + nextDetectionDelayMs(attempt)),
    },
    where: { id: paymentRequestId, status: PaymentRequestStatus.PENDING },
  });
}

export async function lockActionPaymentLifecycle(
  tx: Prisma.TransactionClient,
  actionId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kaspalinks:payment:${actionId}`}, 0))`,
  );
}

export async function lockRecipientPaymentLifecycle(
  tx: Prisma.TransactionClient,
  request: Pick<PaymentRequest, "network" | "recipientAddress">,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kaspalinks:recipient:${request.network}:${request.recipientAddress}`}, 0))`,
  );
}

class AmbiguousPaymentError extends Error {}

export async function detectAndConfirmPayment(
  paymentRequest: PaymentRequest,
  indexer: KaspaIndexer,
  prisma: PrismaClient,
  context: ChainConfirmContext = {},
  now = Date.now(),
): Promise<ChainConfirmResult> {
  if (paymentRequest.status !== PaymentRequestStatus.PENDING) return { kind: "skipped" };
  const lastProbe = lastProbeAt.get(paymentRequest.id);
  if (lastProbe !== undefined && now - lastProbe < INDEXER_COOLDOWN_MS) {
    return { kind: "skipped" };
  }
  lastProbeAt.set(paymentRequest.id, now);

  let matches: KaspaIndexerMatch[];
  try {
    matches = await findCandidateMatches(paymentRequest, indexer, context.reportedTxId ?? null);
  } catch (error) {
    return { kind: "error", reason: (error as Error).message };
  }

  for (const candidate of matches) {
    try {
      const confirmed = await confirmCandidate(
        prisma,
        paymentRequest,
        candidate,
        indexer.providerId,
        context.ipHash ?? null,
        new Date(now),
      );
      if (confirmed) return { kind: "confirmed", paymentRequest: confirmed };
    } catch (error) {
      if (error instanceof AmbiguousPaymentError) return { kind: "ambiguous" };
      if (isUniqueError(error)) continue;
      return { kind: "error", reason: (error as Error).message };
    }
  }

  return { kind: "no_match" };
}

async function confirmCandidate(
  prisma: PrismaClient,
  input: PaymentRequest,
  candidate: KaspaIndexerMatch,
  providerId: string,
  ipHash: null | string,
  confirmedAt: Date,
): Promise<PaymentRequest | null> {
  return confirmPayment(prisma, input, {
    amountSompi: candidate.matchedSompi,
    blockTime: candidate.blockTime,
    auditEvent: "payment_request.chain_confirmed",
    auditMetadata: {
      matchedSompi: candidate.matchedSompi.toString(),
      outputIndex: candidate.outputIndex,
      provider: providerId,
      txId: candidate.transactionId,
      variableAmount: input.amountSompi === null,
    },
    confirmedAt,
    detectionSource: providerId,
    ipHash,
    notify: true,
    transactionId: candidate.transactionId,
  });
}

export async function confirmMockPayment(
  prisma: PrismaClient,
  input: PaymentRequest,
  fakeTxId: string,
  ipHash: null | string,
  confirmedAt = new Date(),
): Promise<PaymentRequest | null> {
  if (input.amountSompi === null) {
    throw new Error("A mock-confirmed payment request must have an amount.");
  }
  return confirmPayment(prisma, input, {
    amountSompi: input.amountSompi,
    auditEvent: "payment_request.mock_confirmed",
    auditMetadata: { fakeTxId },
    confirmedAt,
    detectionSource: "mock",
    fakeTxId,
    ipHash,
    notify: false,
    transactionId: fakeTxId,
  });
}

async function confirmPayment(
  prisma: PrismaClient,
  input: PaymentRequest,
  confirmation: PaymentConfirmationInput,
): Promise<PaymentRequest | null> {
  return prisma.$transaction(async (tx) => {
    await lockActionPaymentLifecycle(tx, input.actionId);
    await lockRecipientPaymentLifecycle(tx, input);
    const current = await tx.paymentRequest.findUnique({
      include: {
        action: {
          include: {
            creator: { include: { telegramConnection: true } },
            notificationRules: { where: { status: NotificationRuleStatus.ACTIVE } },
          },
        },
      },
      where: { id: input.id },
    });
    if (!current || current.status !== PaymentRequestStatus.PENDING) return null;
    if (!confirmation.fakeTxId) {
      const blockTime = confirmation.blockTime;
      if (
        typeof blockTime !== "number" ||
        !Number.isFinite(blockTime) ||
        blockTime < current.createdAt.getTime() ||
        blockTime >= current.expiresAt.getTime()
      )
        return null;
      if (current.amountSompi !== null && current.amountSompi !== confirmation.amountSompi)
        return null;
      // Address/amount matching cannot choose safely between overlapping intents,
      // even when a caller supplies the publicly visible transaction id.
      const possibleRequests = await tx.paymentRequest.count({
        where: {
          network: current.network,
          recipientAddress: current.recipientAddress,
          // Expiring another request must not turn an ambiguous historical
          // payment into a uniquely attributable payment for this request.
          status: { in: [PaymentRequestStatus.PENDING, PaymentRequestStatus.EXPIRED] },
          createdAt: { lte: new Date(blockTime) },
          expiresAt: { gt: new Date(blockTime) },
          OR: [{ amountSompi: null }, { amountSompi: confirmation.amountSompi }],
        },
      });
      if (possibleRequests !== 1) throw new AmbiguousPaymentError();
    }

    const duplicate = confirmation.fakeTxId
      ? await tx.paymentRequest.findUnique({
          select: { id: true },
          where: { fakeTxId: confirmation.fakeTxId },
        })
      : await tx.paymentRequest.findUnique({
          select: { id: true },
          where: { txId: confirmation.transactionId },
        });
    if (duplicate && duplicate.id !== current.id) return null;

    const updated = await tx.paymentRequest.updateMany({
      data: {
        ...(current.amountSompi === null ? { amountSompi: confirmation.amountSompi } : {}),
        confirmedAt: confirmation.confirmedAt,
        detectionSource: confirmation.detectionSource,
        ...(confirmation.fakeTxId
          ? { fakeTxId: confirmation.fakeTxId }
          : { txId: confirmation.transactionId }),
        nextDetectionAt: null,
        status: PaymentRequestStatus.CONFIRMED,
      },
      where: { id: current.id, status: PaymentRequestStatus.PENDING },
    });
    if (updated.count !== 1) return null;

    const exactInvoicePayment =
      current.action.type === ActionType.KASPA_INVOICE &&
      current.action.amountSompi !== null &&
      confirmation.amountSompi === current.action.amountSompi;
    if (exactInvoicePayment) {
      await tx.action.updateMany({
        data: { invoicePaidAt: confirmation.confirmedAt },
        where: { id: current.actionId, invoicePaidAt: null },
      });
    }

    await tx.auditLog.create({
      data: {
        actionId: current.actionId,
        actorType: AuditActorType.SYSTEM,
        creatorId: current.action.creatorId,
        event: confirmation.auditEvent,
        ipHash: confirmation.ipHash,
        metadata: confirmation.auditMetadata,
        paymentRequestId: current.id,
      },
    });

    const event = await tx.paymentEvent.create({
      data: {
        actionId: current.actionId,
        amountSompi: confirmation.amountSompi,
        creatorId: current.action.creatorId,
        occurredAt: confirmation.confirmedAt,
        paymentRequestId: current.id,
        txId: confirmation.transactionId,
      },
    });

    const creator = current.action.creator;
    const connection = creator?.telegramConnection;
    const matchingRules = current.action.notificationRules.filter((rule) =>
      notificationRuleMatches(rule, {
        actionId: current.actionId,
        amountSompi: confirmation.amountSompi,
      }),
    );
    if (
      confirmation.notify &&
      connection &&
      !connection.blockedAt &&
      (connection.notificationsEnabled || matchingRules.length > 0)
    ) {
      const includeSupporter = connection.supporterDetailsEnabled && current.supporterPublic;
      await tx.telegramOutbox.create({
        data: {
          connectionId: connection.id,
          creatorId: creator.id,
          dedupeKey: `telegram:payment:${current.id}`,
          kind: "payment.confirmed",
          matchedRuleIds: matchingRules.map((rule) => rule.id),
          paymentEventId: event.id,
          payload: {
            actionTitle: current.action.title,
            amountSompi: confirmation.amountSompi.toString(),
            explorerUrl: `https://kaspa.stream/transactions/${confirmation.transactionId}`,
            supporterMessage: includeSupporter ? current.supporterMessage : null,
            supporterName: includeSupporter ? current.supporterName : null,
            txId: confirmation.transactionId,
          },
        },
      });
    }

    return tx.paymentRequest.findUnique({ where: { id: current.id } });
  });
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function resetPaymentDetectorForTests(): void {
  lastProbeAt.clear();
}

async function findCandidateMatches(
  paymentRequest: PaymentRequest,
  indexer: KaspaIndexer,
  reportedTxId: null | string,
): Promise<KaspaIndexerMatch[]> {
  const common = {
    amountSompi: paymentRequest.amountSompi,
    notBefore: paymentRequest.createdAt.getTime(),
    recipientAddress: paymentRequest.recipientAddress,
  };
  if (reportedTxId) {
    const direct = await indexer.findTransactionPayment({ ...common, transactionId: reportedTxId });
    return direct ? [direct] : [];
  }

  const incoming = await indexer.listIncomingPayments({
    notBefore: common.notBefore,
    recipientAddress: common.recipientAddress,
  });
  const matches: KaspaIndexerMatch[] = [];
  for (const candidate of sortIncomingPayments(incoming)) {
    if (
      paymentRequest.amountSompi !== null &&
      candidate.matchedSompi !== paymentRequest.amountSompi
    ) {
      continue;
    }
    if (!matches.some((match) => sameOutput(match, candidate))) matches.push(candidate);
  }
  return matches;
}

function sortIncomingPayments(payments: KaspaIndexerIncomingPayment[]) {
  return [...payments].sort((left, right) => {
    if (left.blockTime === null && right.blockTime === null) return 0;
    if (left.blockTime === null) return 1;
    if (right.blockTime === null) return -1;
    return left.blockTime - right.blockTime;
  });
}

function sameOutput(left: KaspaIndexerMatch, right: KaspaIndexerIncomingPayment): boolean {
  return left.transactionId === right.transactionId && left.outputIndex === right.outputIndex;
}
