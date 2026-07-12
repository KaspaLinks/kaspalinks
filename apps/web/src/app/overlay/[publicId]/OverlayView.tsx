"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import type { PublicActionMetadata } from "@/lib/action-serializer";
import type { SerializedPaymentRequest } from "@/lib/payment-request-serializer";

import { LogoMark } from "../../LogoMark";

type OverlayViewProps = {
  action: PublicActionMetadata;
  actionUrl: string;
  paymentRequestId: null | string;
  paymentUri: string;
};

const POLL_INTERVAL_MS = 3_000;

function formatAddress(address: string) {
  if (address.length <= 28) {
    return address;
  }

  return `${address.slice(0, 18)}...${address.slice(-10)}`;
}

function statusLabel(status: SerializedPaymentRequest["status"] | null) {
  if (!status) return "PREVIEW";
  return status;
}

function statusClass(status: SerializedPaymentRequest["status"] | null) {
  switch (status) {
    case "CONFIRMED":
      return "overlay-status overlay-status-confirmed";
    case "EXPIRED":
    case "FAILED":
      return "overlay-status overlay-status-ended";
    case "PENDING":
      return "overlay-status overlay-status-pending";
    default:
      return "overlay-status overlay-status-preview";
  }
}

function statusCopy(status: SerializedPaymentRequest["status"] | null) {
  switch (status) {
    case "CONFIRMED":
      return "Payment confirmed";
    case "EXPIRED":
      return "Request expired";
    case "FAILED":
      return "Request failed";
    case "PENDING":
      return "Waiting for payment";
    default:
      return "Scan or open the link";
  }
}

function useQrDataUrl(value: string): null | string {
  const [dataUrl, setDataUrl] = useState<null | string>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      color: {
        dark: "#2a8e84",
        light: "#ffffff",
      },
      errorCorrectionLevel: "H",
      margin: 2,
      width: 420,
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  return dataUrl;
}

export function OverlayView({ action, actionUrl, paymentRequestId, paymentUri }: OverlayViewProps) {
  const [paymentRequest, setPaymentRequest] = useState<null | SerializedPaymentRequest>(null);
  const [error, setError] = useState<null | string>(null);
  const qrTarget = paymentRequest?.paymentUri ?? paymentUri;
  const qrDataUrl = useQrDataUrl(qrTarget);
  const status = paymentRequest?.status ?? null;

  useEffect(() => {
    if (!paymentRequestId) return;

    const statusPaymentRequestId = paymentRequestId;
    let cancelled = false;
    let interval: null | number = null;

    async function loadStatus() {
      try {
        const response = await fetch(
          `/api/payment-requests/${encodeURIComponent(statusPaymentRequestId)}/status`,
        );
        const body = await response.json();

        if (!response.ok) {
          if (!cancelled) setError(body?.error?.message ?? "Payment request unavailable.");
          return;
        }

        const nextPaymentRequest = body.paymentRequest as SerializedPaymentRequest;

        if (!cancelled) {
          setPaymentRequest(nextPaymentRequest);
          setError(null);
        }

        if (nextPaymentRequest.status !== "PENDING" && interval !== null) {
          window.clearInterval(interval);
          interval = null;
        }
      } catch {
        if (!cancelled) setError("Status polling unavailable.");
      }
    }

    void loadStatus();
    interval = window.setInterval(loadStatus, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (interval !== null) {
        window.clearInterval(interval);
      }
    };
  }, [paymentRequestId]);

  return (
    <main className="overlay-page">
      <section className="overlay-panel">
        <div className="overlay-copy">
          <span className={statusClass(status)}>{statusLabel(status)}</span>
          <p className="overlay-eyebrow">{action.type}</p>
          <h1>{action.title}</h1>
          {action.description ? <p className="overlay-description">{action.description}</p> : null}
          <div className="overlay-amount">
            {action.amountKas ? `${action.amountKas} KAS` : "Any amount"}
          </div>
          <p className="overlay-address">{formatAddress(action.recipientAddress)}</p>
          <p className="overlay-note">Non-custodial · verify address · status source may vary</p>
        </div>

        <div className="overlay-qr-wrap">
          {qrDataUrl ? (
            <div className="overlay-branded-qr-shell">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="Kaspa payment QR code" className="overlay-qr" src={qrDataUrl} />
              <span className="branded-qr-mark" aria-hidden="true">
                <LogoMark size={34} title={undefined} variant="solid" />
              </span>
            </div>
          ) : (
            <div className="overlay-qr overlay-qr-placeholder" aria-hidden />
          )}
          <p className="overlay-status-copy">{error ?? statusCopy(status)}</p>
          <p className="overlay-url">{actionUrl}</p>
        </div>
      </section>
    </main>
  );
}
