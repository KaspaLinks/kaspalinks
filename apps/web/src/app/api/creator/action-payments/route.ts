import { prisma } from "@kaspa-actions/db";
import { Network, PaymentRequestStatus } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { requireCreator } from "@/lib/creator-guard";
import { apiJson, apiMethodNotAllowed } from "@/lib/errors";
import { getKaspaIndexer } from "@/lib/indexer";

const PAYMENT_SCAN_LIMIT = 25;
const SUPPORTER_MESSAGE_LIMIT = 6;
const SUPPORTER_WALL_LIMIT = 8;

type CreatorAction = {
  createdAt: Date;
  network: Network;
  publicId: string;
  recipientAddress: string;
};

type AddressPaymentState = {
  error: null | string;
  payments: Array<{
    amountKas: string;
    amountSompi: string;
    blockTime: null | number;
    outputIndex: number;
    transactionId: string;
  }>;
  summary: null | {
    count: number;
    providerId: string;
    scanLimit: number;
    totalKas: string;
    totalSompi: string;
  };
};

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const actions = await prisma.action.findMany({
    select: {
      createdAt: true,
      network: true,
      publicId: true,
      recipientAddress: true,
    },
    where: {
      creatorId: guard.creator.id,
      deletedAt: null,
    },
  });

  const uniqueAddressGroups = new Map<string, CreatorAction>();
  for (const action of actions) {
    uniqueAddressGroups.set(addressGroupKey(action), action);
  }

  const statesByAddress = new Map<string, AddressPaymentState>();
  await Promise.all(
    Array.from(uniqueAddressGroups.entries()).map(async ([key, action]) => {
      statesByAddress.set(key, await loadAddressPaymentState(action));
    }),
  );

  const recentSupporterMessages = await prisma.paymentRequest.findMany({
    orderBy: { confirmedAt: "desc" },
    select: {
      amountSompi: true,
      confirmedAt: true,
      supporterMessage: true,
      txId: true,
      action: {
        select: {
          network: true,
          publicId: true,
          slug: true,
          title: true,
        },
      },
    },
    take: SUPPORTER_MESSAGE_LIMIT,
    where: {
      action: {
        creatorId: guard.creator.id,
        deletedAt: null,
      },
      status: PaymentRequestStatus.CONFIRMED,
      supporterMessage: {
        not: null,
      },
    },
  });

  const supporterWallEntries = await prisma.paymentRequest.findMany({
    orderBy: { confirmedAt: "desc" },
    select: {
      amountSompi: true,
      confirmedAt: true,
      id: true,
      supporterHiddenAt: true,
      supporterMessage: true,
      supporterName: true,
      txId: true,
      action: {
        select: {
          network: true,
          publicId: true,
          slug: true,
          title: true,
        },
      },
    },
    take: SUPPORTER_WALL_LIMIT,
    where: {
      // Include hidden entries too — the dashboard shows them (muted, with a
      // "Show" action) so the creator can re-reveal. The public wall route
      // keeps its own supporterHiddenAt: null filter, so hidden stays hidden.
      action: {
        creatorId: guard.creator.id,
        deletedAt: null,
      },
      status: PaymentRequestStatus.CONFIRMED,
      supporterPublic: true,
    },
  });

  return apiJson({
    paymentStates: Object.fromEntries(
      actions.map((action) => [
        action.publicId,
        // The indexer call is cached per address, but each action still wants
        // its own view: only payments that arrived AFTER this specific link
        // was created are attributable to it. Without this filter, a creator
        // re-using an address they had already received KAS to would see
        // every old receipt counted as "earned via Kaspa Links" — that's the
        // pre-existing-balance bug the dashboard had until this commit.
        applyActionCreatedCutoff(
          statesByAddress.get(addressGroupKey(action)) ?? emptyPaymentState(),
          action.createdAt.getTime(),
        ),
      ]),
    ),
    recentSupporterMessages: recentSupporterMessages.map((message) => ({
      actionPublicId: message.action.publicId,
      actionTitle: message.action.title,
      amountKas: message.amountSompi !== null ? formatSompiToKaspa(message.amountSompi) : null,
      confirmedAt: message.confirmedAt ? message.confirmedAt.toISOString() : null,
      message: message.supporterMessage ?? "",
      network: message.action.network === Network.TESTNET ? "testnet" : "mainnet",
      sharePath:
        message.action.slug === null
          ? `/a/${encodeURIComponent(message.action.publicId)}`
          : `/u/${encodeURIComponent(guard.creator.username)}/${encodeURIComponent(
              message.action.slug,
            )}`,
      txId: message.txId,
    })),
    supporterWallEntries: supporterWallEntries.map((entry) => ({
      actionPublicId: entry.action.publicId,
      actionTitle: entry.action.title,
      amountKas: entry.amountSompi !== null ? formatSompiToKaspa(entry.amountSompi) : null,
      confirmedAt: entry.confirmedAt ? entry.confirmedAt.toISOString() : null,
      hidden: entry.supporterHiddenAt !== null,
      id: entry.id,
      message: entry.supporterMessage ?? null,
      network: entry.action.network === Network.TESTNET ? "testnet" : "mainnet",
      sharePath:
        entry.action.slug === null
          ? `/a/${encodeURIComponent(entry.action.publicId)}`
          : `/u/${encodeURIComponent(guard.creator.username)}/${encodeURIComponent(
              entry.action.slug,
            )}`,
      supporterName: entry.supporterName ?? null,
      txId: entry.txId,
    })),
  });
}

function addressGroupKey(action: CreatorAction): string {
  return `${action.network}:${action.recipientAddress}`;
}

async function loadAddressPaymentState(action: CreatorAction): Promise<AddressPaymentState> {
  const network = action.network === Network.TESTNET ? "testnet" : "mainnet";
  const indexer = getKaspaIndexer(network);
  if (!indexer) {
    return {
      ...emptyPaymentState(),
      error: "Chain lookup is not configured for this network.",
    };
  }

  try {
    const payments = await indexer.listIncomingPayments({
      recipientAddress: action.recipientAddress,
      scanLimit: PAYMENT_SCAN_LIMIT,
    });
    const totalSompi = payments.reduce((sum, payment) => sum + payment.matchedSompi, 0n);

    return {
      error: null,
      payments: payments.map((payment) => ({
        amountKas: formatSompiToKaspa(payment.matchedSompi),
        amountSompi: payment.matchedSompi.toString(),
        blockTime: payment.blockTime,
        outputIndex: payment.outputIndex,
        transactionId: payment.transactionId,
      })),
      summary: {
        count: payments.length,
        providerId: indexer.providerId,
        scanLimit: PAYMENT_SCAN_LIMIT,
        totalKas: totalSompi === 0n ? "0" : formatSompiToKaspa(totalSompi),
        totalSompi: totalSompi.toString(),
      },
    };
  } catch {
    return {
      ...emptyPaymentState(),
      error: "Could not load address payments.",
    };
  }
}

function emptyPaymentState(): AddressPaymentState {
  return {
    error: null,
    payments: [],
    summary: null,
  };
}

/**
 * Trims an address-wide payment state down to receipts that arrived at or
 * after the given action's createdAt. Receipts without a blockTime are
 * excluded because we cannot prove they happened after the cutoff —
 * including them would re-introduce the pre-existing-balance leak.
 *
 * Returns the input unchanged when no payments were trimmed, so React
 * downstream sees identity-equal objects and avoids unnecessary re-renders.
 */
function applyActionCreatedCutoff(
  state: AddressPaymentState,
  actionCreatedAtMs: number,
): AddressPaymentState {
  if (state.payments.length === 0) return state;

  const filteredPayments = state.payments.filter(
    (payment) => payment.blockTime !== null && payment.blockTime >= actionCreatedAtMs,
  );
  if (filteredPayments.length === state.payments.length) return state;

  const totalSompi = filteredPayments.reduce(
    (sum, payment) => sum + safeBigInt(payment.amountSompi),
    0n,
  );

  return {
    error: state.error,
    payments: filteredPayments,
    summary: state.summary
      ? {
          ...state.summary,
          count: filteredPayments.length,
          totalKas: totalSompi === 0n ? "0" : formatSompiToKaspa(totalSompi),
          totalSompi: totalSompi.toString(),
        }
      : null,
  };
}

function safeBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
