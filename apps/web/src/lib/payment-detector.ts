import type { PaymentRequest, PrismaClient } from "@kaspa-actions/db";
import { AuditActorType, PaymentRequestStatus } from "@kaspa-actions/db";
import type {
  KaspaIndexer,
  KaspaIndexerIncomingPayment,
  KaspaIndexerMatch,
} from "@kaspa-actions/kaspa-indexer";

import { writeAuditLog } from "./audit";
import { isPrismaUniqueConstraintError } from "./prisma-errors";

/** Minimum interval (ms) between realtime indexer probes for the same pending payment request. */
const INDEXER_COOLDOWN_MS = 1_500;

const lastProbeAt = new Map<string, number>();

export type ChainConfirmContext = {
  ipHash?: null | string;
  reportedTxId?: null | string;
};

export type ChainConfirmResult =
  | { kind: "confirmed"; paymentRequest: PaymentRequest }
  | { kind: "error"; reason: string }
  | { kind: "no_match" }
  | { kind: "skipped" };

export async function detectAndConfirmPayment(
  paymentRequest: PaymentRequest,
  indexer: KaspaIndexer,
  prisma: PrismaClient,
  context: ChainConfirmContext = {},
  now = Date.now(),
): Promise<ChainConfirmResult> {
  if (paymentRequest.status !== PaymentRequestStatus.PENDING) {
    return { kind: "skipped" };
  }

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

  if (matches.length === 0) {
    return { kind: "no_match" };
  }

  for (const candidate of matches) {
    const existing = await prisma.paymentRequest.findUnique({
      where: { txId: candidate.transactionId },
    });

    if (existing && existing.id !== paymentRequest.id) {
      // Another PaymentRequest already claimed this transaction. Keep scanning:
      // several same-amount payments can legitimately land at one creator address.
      continue;
    }

    try {
      const updated = await prisma.paymentRequest.updateMany({
        data: {
          // If the PR had a variable amount, record the actual paid value now.
          ...(paymentRequest.amountSompi === null
            ? { amountSompi: candidate.matchedSompi }
            : {}),
          confirmedAt: new Date(now),
          detectionSource: indexer.providerId,
          status: PaymentRequestStatus.CONFIRMED,
          txId: candidate.transactionId,
        },
        where: {
          id: paymentRequest.id,
          status: PaymentRequestStatus.PENDING,
        },
      });

      if (updated.count === 0) {
        return { kind: "skipped" };
      }

      const confirmed = await prisma.paymentRequest.findUnique({
        where: { id: paymentRequest.id },
      });
      if (!confirmed) {
        return { kind: "error", reason: "Confirmed payment request could not be reloaded." };
      }

      await writeAuditLog(prisma, {
        actionId: confirmed.actionId,
        actorType: AuditActorType.SYSTEM,
        event: "payment_request.chain_confirmed",
        ipHash: context.ipHash ?? null,
        metadata: {
          matchedSompi: candidate.matchedSompi.toString(),
          outputIndex: candidate.outputIndex,
          provider: indexer.providerId,
          txId: candidate.transactionId,
          variableAmount: paymentRequest.amountSompi === null,
        },
        paymentRequestId: confirmed.id,
      });

      return { kind: "confirmed", paymentRequest: confirmed };
    } catch (error) {
      if (isPrismaUniqueConstraintError(error, ["txId"])) {
        continue;
      }
      return { kind: "error", reason: (error as Error).message };
    }
  }

  return { kind: "no_match" };
}

/** Test helper: clears the per-request cooldown cache. */
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
  const matches: KaspaIndexerMatch[] = [];

  if (reportedTxId) {
    const direct = await indexer.findTransactionPayment({
      ...common,
      transactionId: reportedTxId,
    });
    return direct ? [direct] : [];
  }

  const incoming = await indexer.listIncomingPayments({
    notBefore: common.notBefore,
    recipientAddress: common.recipientAddress,
  });
  for (const candidate of sortIncomingPayments(incoming)) {
    if (
      paymentRequest.amountSompi !== null &&
      candidate.matchedSompi !== paymentRequest.amountSompi
    ) {
      continue;
    }
    if (!matches.some((match) => sameOutput(match, candidate))) {
      matches.push(candidate);
    }
  }

  return matches;
}

function sortIncomingPayments(
  payments: KaspaIndexerIncomingPayment[],
): KaspaIndexerIncomingPayment[] {
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
