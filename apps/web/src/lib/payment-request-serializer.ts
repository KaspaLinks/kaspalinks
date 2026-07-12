import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import type { PaymentRequest } from "@kaspa-actions/db";

export const PAYMENT_REQUEST_LIFETIME_MS = 15 * 60 * 1000;

export type SerializedPaymentRequest = {
  amountKas: null | string;
  amountSompi: null | string;
  confirmedAt: null | string;
  createdAt: string;
  detectionSource: null | string;
  expiresAt: string;
  failedAt: null | string;
  fakeTxId: null | string;
  id: string;
  network: "mainnet" | "testnet";
  paymentUri: null | string;
  recipientAddress: string;
  requestedMessage: null | string;
  status: "PENDING" | "CONFIRMED" | "EXPIRED" | "FAILED";
  supporterMessage: null | string;
  supporterName: null | string;
  supporterPublic: boolean;
  txId: null | string;
};

export function serializePaymentRequest(request: PaymentRequest): SerializedPaymentRequest {
  const amount = request.amountSompi;
  return {
    amountKas: amount !== null && amount !== undefined ? formatSompiToKaspa(amount) : null,
    amountSompi: amount !== null && amount !== undefined ? amount.toString() : null,
    confirmedAt: request.confirmedAt ? request.confirmedAt.toISOString() : null,
    createdAt: request.createdAt.toISOString(),
    detectionSource: request.detectionSource,
    expiresAt: request.expiresAt.toISOString(),
    failedAt: request.failedAt ? request.failedAt.toISOString() : null,
    fakeTxId: request.fakeTxId,
    id: request.id,
    network: request.network === "TESTNET" ? "testnet" : "mainnet",
    paymentUri: request.paymentUri,
    recipientAddress: request.recipientAddress,
    requestedMessage: request.requestedMessage,
    status: request.status,
    supporterMessage: request.supporterMessage,
    supporterName: request.supporterName,
    supporterPublic: request.supporterPublic,
    txId: request.txId,
  };
}

export function shouldLazyExpire(
  request: Pick<PaymentRequest, "expiresAt" | "status">,
  now = new Date(),
): boolean {
  return request.status === "PENDING" && request.expiresAt.getTime() <= now.getTime();
}
