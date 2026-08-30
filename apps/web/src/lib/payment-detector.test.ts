import { beforeEach, describe, expect, it } from "vitest";

import type { PaymentRequest, PrismaClient } from "@kaspa-actions/db";
import { ActionType, Network, NotificationRuleKind, PaymentRequestStatus } from "@kaspa-actions/db";
import type {
  KaspaIndexer,
  KaspaIndexerIncomingPayment,
  KaspaIndexerMatch,
} from "@kaspa-actions/kaspa-indexer";

import {
  confirmMockPayment,
  detectAndConfirmPayment,
  resetPaymentDetectorForTests,
} from "./payment-detector";

const RECIPIENT = "kaspatest:qqnapngv3zxp305qf06w6hpzmyxtx2r99jjhs04lu980xdyd2ulwwmx9evrfz";

type PrismaStub = {
  audits: Array<{ event: string; metadata?: unknown }>;
  client: PrismaClient;
  control: { expireBeforeUpdate: boolean };
  events: Array<{ paymentRequestId: string; txId: string }>;
  existingByTxId: Map<string, PaymentRequest>;
  invoicePaidAt: Date | null;
  outbox: Array<{ dedupeKey: string }>;
  request: PaymentRequest;
};

function buildPaymentRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  const createdAt = new Date("2026-05-13T10:00:00.000Z");
  return {
    actionId: "action-1",
    amountSompi: 1_000_000_000n,
    confirmedAt: null,
    createdAt,
    detectionAttempts: 0,
    detectionSource: null,
    expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
    failedAt: null,
    fakeTxId: null,
    id: "pr-1",
    network: Network.TESTNET,
    nextDetectionAt: null,
    paymentUri: null,
    recipientAddress: RECIPIENT,
    requestedMessage: null,
    status: PaymentRequestStatus.PENDING,
    supporterHiddenAt: null,
    supporterMessage: null,
    supporterName: null,
    supporterPublic: false,
    txId: null,
    updatedAt: createdAt,
    ...overrides,
  };
}

function buildPrismaStub(
  initial: Partial<PaymentRequest> = {},
  options: { actionType?: ActionType; telegramConnected?: boolean } = {},
): PrismaStub {
  const audits: Array<{ event: string; metadata?: unknown }> = [];
  const control = { expireBeforeUpdate: false };
  const events: Array<{ paymentRequestId: string; txId: string }> = [];
  const existingByTxId = new Map<string, PaymentRequest>();
  let invoicePaidAt: Date | null = null;
  const outbox: Array<{ dedupeKey: string }> = [];
  const request = buildPaymentRequest(initial);

  const tx = {
    $queryRaw: async () => [{ pg_advisory_xact_lock: null }],
    action: {
      updateMany: async ({ data }: { data: { invoicePaidAt: Date } }) => {
        invoicePaidAt = data.invoicePaidAt;
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: { event: string; metadata?: unknown } }) => {
        audits.push({ event: data.event, metadata: data.metadata });
      },
    },
    paymentEvent: {
      create: async ({ data }: { data: { paymentRequestId: string; txId: string } }) => {
        events.push({ paymentRequestId: data.paymentRequestId, txId: data.txId });
        return { id: `event-${events.length}`, ...data };
      },
    },
    paymentRequest: {
      findUnique: async ({
        include,
        where,
      }: {
        include?: unknown;
        where: { id?: string; txId?: string };
      }) => {
        if (where.id === request.id) {
          if (!include) return request;
          return {
            ...request,
            action: {
              amountSompi: request.amountSompi,
              creator: options.telegramConnected
                ? {
                    id: "creator-1",
                    telegramConnection: {
                      blockedAt: null,
                      id: "connection-1",
                      notificationsEnabled: true,
                      supporterDetailsEnabled: false,
                    },
                  }
                : null,
              creatorId: options.telegramConnected ? "creator-1" : null,
              id: request.actionId,
              notificationRules: options.telegramConnected
                ? [
                    {
                      actionId: null,
                      completeOnInvoicePayment: false,
                      id: "rule-1",
                      kind: NotificationRuleKind.ALL_PAYMENTS,
                      minimumSompi: null,
                    },
                  ]
                : [],
              type: options.actionType ?? ActionType.KASPA_TIP,
            },
          };
        }
        if (where.txId && existingByTxId.has(where.txId)) {
          return existingByTxId.get(where.txId) ?? null;
        }
        return null;
      },
      updateMany: async ({
        data,
        where,
      }: {
        data: Partial<PaymentRequest>;
        where: { id: string; status: PaymentRequestStatus };
      }) => {
        if (where.id !== request.id) {
          throw new Error("Unexpected update target");
        }
        if (control.expireBeforeUpdate) {
          request.status = PaymentRequestStatus.EXPIRED;
        }
        if (request.status !== where.status) return { count: 0 };
        Object.assign(request, data);
        if (request.txId) {
          existingByTxId.set(request.txId, request);
        }
        return { count: 1 };
      },
    },
    telegramOutbox: {
      create: async ({ data }: { data: { dedupeKey: string } }) => {
        outbox.push({ dedupeKey: data.dedupeKey });
        return data;
      },
    },
  };

  const client = {
    ...tx,
    $transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx),
  } as unknown as PrismaClient;

  return {
    audits,
    client,
    control,
    events,
    existingByTxId,
    get invoicePaidAt() {
      return invoicePaidAt;
    },
    outbox,
    request,
  };
}

function buildIndexer(
  match: KaspaIndexerMatch | null,
  options: {
    directMatch?: KaspaIndexerMatch | null;
    incoming?: KaspaIndexerIncomingPayment[];
    providerId?: string;
    throwError?: Error;
  } = {},
): KaspaIndexer {
  return {
    async findIncomingPayment() {
      if (options.throwError) throw options.throwError;
      return match;
    },
    async findTransactionPayment() {
      if (options.throwError) throw options.throwError;
      return options.directMatch ?? null;
    },
    async listIncomingPayments() {
      if (options.throwError) throw options.throwError;
      return options.incoming ?? (match ? [match] : []);
    },
    providerId: options.providerId ?? "rest:test-indexer",
  };
}

beforeEach(() => {
  resetPaymentDetectorForTests();
});

describe("detectAndConfirmPayment", () => {
  it("confirms a pending request when the indexer returns a match", async () => {
    const stub = buildPrismaStub();
    const indexer = buildIndexer({
      blockTime: 1_770_000_000_000,
      matchedSompi: 1_000_000_000n,
      outputIndex: 0,
      transactionId: "real-tx-id",
    });

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client, {
      ipHash: "ip-hash",
    });

    expect(result.kind).toBe("confirmed");
    expect(stub.request.status).toBe(PaymentRequestStatus.CONFIRMED);
    expect(stub.request.txId).toBe("real-tx-id");
    expect(stub.request.detectionSource).toBe("rest:test-indexer");
    expect(stub.audits).toHaveLength(1);
    expect(stub.audits[0]?.event).toBe("payment_request.chain_confirmed");
    expect(stub.events).toEqual([{ paymentRequestId: "pr-1", txId: "real-tx-id" }]);
    expect(stub.outbox).toHaveLength(0);
  });

  it("atomically closes an invoice and creates one event and one Telegram delivery", async () => {
    const stub = buildPrismaStub(
      { amountSompi: 1_000_000_000n },
      { actionType: ActionType.KASPA_INVOICE, telegramConnected: true },
    );
    const indexer = buildIndexer({
      blockTime: 1_770_000_000_000,
      matchedSompi: 1_000_000_000n,
      outputIndex: 0,
      transactionId: "invoice-tx-id",
    });

    const first = await detectAndConfirmPayment(stub.request, indexer, stub.client);
    const replay = await detectAndConfirmPayment(
      stub.request,
      indexer,
      stub.client,
      {},
      Date.now() + 2_000,
    );

    expect(first.kind).toBe("confirmed");
    expect(replay.kind).toBe("skipped");
    expect(stub.invoicePaidAt).toBeInstanceOf(Date);
    expect(stub.events).toHaveLength(1);
    expect(stub.outbox).toEqual([{ dedupeKey: "telegram:payment:pr-1" }]);
  });

  it("skips when the request is not PENDING", async () => {
    const stub = buildPrismaStub({ status: PaymentRequestStatus.CONFIRMED });
    const indexer = buildIndexer({
      blockTime: null,
      matchedSompi: 1_000_000_000n,
      outputIndex: 0,
      transactionId: "real-tx-id",
    });

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client);

    expect(result.kind).toBe("skipped");
    expect(stub.audits).toHaveLength(0);
  });

  it("returns no_match when the indexer finds nothing", async () => {
    const stub = buildPrismaStub();
    const indexer = buildIndexer(null);

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client);

    expect(result.kind).toBe("no_match");
    expect(stub.request.status).toBe(PaymentRequestStatus.PENDING);
    expect(stub.audits).toHaveLength(0);
  });

  it("does not confirm twice if the txId already belongs to another request", async () => {
    const stub = buildPrismaStub();
    const other = buildPaymentRequest({ id: "pr-other", txId: "real-tx-id" });
    stub.existingByTxId.set("real-tx-id", other);

    const indexer = buildIndexer({
      blockTime: null,
      matchedSompi: 1_000_000_000n,
      outputIndex: 0,
      transactionId: "real-tx-id",
    });

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client);

    expect(result.kind).toBe("no_match");
    expect(stub.request.status).toBe(PaymentRequestStatus.PENDING);
  });

  it("keeps scanning when a same-amount transaction was already claimed", async () => {
    const stub = buildPrismaStub();
    const other = buildPaymentRequest({ id: "pr-other", txId: "already-claimed" });
    stub.existingByTxId.set("already-claimed", other);

    const indexer = buildIndexer(null, {
      incoming: [
        {
          blockTime: 1_770_000_000_000,
          matchedSompi: 1_000_000_000n,
          outputIndex: 0,
          transactionId: "already-claimed",
        },
        {
          blockTime: 1_770_000_001_000,
          matchedSompi: 1_000_000_000n,
          outputIndex: 0,
          transactionId: "fresh-match",
        },
      ],
    });

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client);

    expect(result.kind).toBe("confirmed");
    expect(stub.request.txId).toBe("fresh-match");
  });

  it("prefers a reported tx id when KasWare provides one", async () => {
    const stub = buildPrismaStub();
    const indexer = buildIndexer(null, {
      directMatch: {
        blockTime: 1_770_000_002_000,
        matchedSompi: 1_000_000_000n,
        outputIndex: 0,
        transactionId: "reported-match",
      },
      incoming: [
        {
          blockTime: 1_770_000_000_000,
          matchedSompi: 1_000_000_000n,
          outputIndex: 0,
          transactionId: "older-address-match",
        },
      ],
    });

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client, {
      reportedTxId: "a".repeat(64),
    });

    expect(result.kind).toBe("confirmed");
    expect(stub.request.txId).toBe("reported-match");
  });

  it("does not fall back to an unrelated address payment when a reported tx id does not match", async () => {
    const stub = buildPrismaStub();
    const indexer = buildIndexer(null, {
      directMatch: null,
      incoming: [
        {
          blockTime: 1_770_000_000_000,
          matchedSompi: 1_000_000_000n,
          outputIndex: 0,
          transactionId: "unrelated-address-match",
        },
      ],
    });

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client, {
      reportedTxId: "a".repeat(64),
    });

    expect(result.kind).toBe("no_match");
    expect(stub.request.status).toBe(PaymentRequestStatus.PENDING);
    expect(stub.request.txId).toBeNull();
  });

  it("does not overwrite a request that stopped being pending during detection", async () => {
    const stub = buildPrismaStub();
    const indexer = buildIndexer(null, {
      incoming: [
        {
          blockTime: 1_770_000_000_000,
          matchedSompi: 1_000_000_000n,
          outputIndex: 0,
          transactionId: "late-match",
        },
      ],
    });
    stub.control.expireBeforeUpdate = true;

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client);

    expect(result.kind).toBe("no_match");
    expect(stub.request.status).toBe(PaymentRequestStatus.EXPIRED);
    expect(stub.request.txId).toBeNull();
  });

  it("respects the per-request cooldown to avoid hammering the indexer", async () => {
    const stub = buildPrismaStub();
    let calls = 0;
    const indexer: KaspaIndexer = {
      async findIncomingPayment() {
        calls += 1;
        return null;
      },
      async findTransactionPayment() {
        return null;
      },
      async listIncomingPayments() {
        calls += 1;
        return [];
      },
      providerId: "rest:test",
    };

    await detectAndConfirmPayment(stub.request, indexer, stub.client, {}, 1_000);
    const cached = await detectAndConfirmPayment(stub.request, indexer, stub.client, {}, 1_500);

    expect(calls).toBe(1);
    expect(cached.kind).toBe("skipped");
  });

  it("returns an error result when the indexer throws", async () => {
    const stub = buildPrismaStub();
    const indexer = buildIndexer(null, { throwError: new Error("network down") });

    const result = await detectAndConfirmPayment(stub.request, indexer, stub.client);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toContain("network down");
    }
    expect(stub.request.status).toBe(PaymentRequestStatus.PENDING);
  });
});

describe("confirmMockPayment", () => {
  it("uses the shared atomic lifecycle without queuing a chain notification", async () => {
    const stub = buildPrismaStub(
      { amountSompi: 1_000_000_000n },
      { actionType: ActionType.KASPA_INVOICE, telegramConnected: true },
    );

    const result = await confirmMockPayment(
      stub.client,
      stub.request,
      "mock-0123456789abcdef",
      "ip-hash",
      new Date("2026-05-13T10:01:00.000Z"),
    );

    expect(result?.status).toBe(PaymentRequestStatus.CONFIRMED);
    expect(stub.request.fakeTxId).toBe("mock-0123456789abcdef");
    expect(stub.invoicePaidAt).toBeInstanceOf(Date);
    expect(stub.audits).toEqual([
      {
        event: "payment_request.mock_confirmed",
        metadata: { fakeTxId: "mock-0123456789abcdef" },
      },
    ]);
    expect(stub.events).toEqual([{ paymentRequestId: "pr-1", txId: "mock-0123456789abcdef" }]);
    expect(stub.outbox).toHaveLength(0);
  });
});
