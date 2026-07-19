"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

import {
  getKaswareProvider,
  readKaswareNetwork,
  sendKaspaPayment,
  type KaspaWalletNetwork,
  WalletAdapterError,
} from "@kaspa-actions/wallet-adapter";

import type { PublicActionMetadata } from "@/lib/action-serializer";
import type { GoalProgress } from "@/lib/goal-progress";
import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";
import type { SerializedPaymentRequest } from "@/lib/payment-request-serializer";
import { formatApproxUsdMeta, formatApproxUsdValue } from "@/lib/price-display";
import {
  getMainnetOutputMinimumMessage,
  MIN_RELIABLE_MAINNET_OUTPUT_KAS,
  MIN_RELIABLE_MAINNET_OUTPUT_SOMPI,
} from "@/lib/mainnet-amount-policy";
import { MIN_REQUIRED_NOTE_LENGTH } from "@/lib/note-policy";
import { useKasUsdPrice } from "@/lib/use-kas-usd-price";
import { buildWalletLaunchUri } from "@/lib/wallet-uri";

import { LogoMark } from "../../LogoMark";
import { WalletConnectCard } from "./WalletConnectCard";

type ActionPaymentFlowProps = {
  action: PublicActionMetadata;
  goalProgress?: GoalProgress | null;
  paymentUri: string;
};

type CopyState = { key: string; at: number } | null;
type PaymentUriPreview =
  | { amountKas: null; error: "EMPTY" | "INVALID" | "TOO_SMALL"; uri: null }
  | { amountKas: string; error: null; uri: string };
type SupporterMessageSaveState = "error" | "idle" | "saved" | "saving";

// Kaspa confirms in well under a second on-chain. The indexer adds 0.5-2s of
// lag, so the user only really needs polling fast enough to feel snappy after
// they sign in their wallet. 1.5s is the sweet spot — twice as responsive as
// the previous 3s without doubling load on the upstream indexer endpoint.
const POLL_INTERVAL_MS = 1_500;
// As soon as KasWare accepts the send flow, fire a status check almost
// immediately instead of waiting up to 1.5s for the next regular tick.
const POST_BROADCAST_FAST_POLL_MS = 300;
const SOMPI_PER_KAS = 100_000_000n;
const MAX_DECIMAL_PLACES = 8;

class AmountTooSmallError extends Error {
  constructor() {
    super(getMainnetOutputMinimumMessage("Payment amount"));
    this.name = "AmountTooSmallError";
  }
}

type KaswareConnectionState = {
  account: null | string;
  checked: boolean;
  connected: boolean;
  installed: boolean;
  network: KaspaWalletNetwork;
};

async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through to legacy fallback */
    }
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function buildWalletFallbackText(input: {
  amountKas: null | string;
  message: null | string;
  recipientAddress: string;
  uri: string;
}): string {
  return [
    `Kaspa payment URI: ${input.uri}`,
    `Address: ${input.recipientAddress}`,
    input.amountKas ? `Amount: ${input.amountKas} KAS` : null,
    input.message ? `Message: ${input.message}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function buildVariablePaymentUriPreview(input: {
  amountKas: string;
  label: string;
  message: null | string;
  recipientAddress: string;
}): PaymentUriPreview {
  const amountKas = normalizeLocalizedKasAmountInput(input.amountKas.trim());

  if (amountKas.length === 0) {
    return { amountKas: null, error: "EMPTY", uri: null };
  }

  try {
    const normalizedAmountKas = normalizeKasAmount(amountKas);
    return {
      amountKas: normalizedAmountKas,
      error: null,
      uri: buildClientPaymentUri({
        amountKas: normalizedAmountKas,
        label: input.label,
        message: input.message,
        recipientAddress: input.recipientAddress,
      }),
    };
  } catch (error) {
    return {
      amountKas: null,
      error: error instanceof AmountTooSmallError ? "TOO_SMALL" : "INVALID",
      uri: null,
    };
  }
}

function parseClientKasAmountToSompi(amountKas: string): bigint {
  if (/^[+]/.test(amountKas) || amountKas.startsWith("-") || /e/i.test(amountKas)) {
    throw new Error("Invalid KAS amount.");
  }

  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amountKas)) {
    throw new Error("Invalid KAS amount.");
  }

  const [wholePart = "0", decimalPart = ""] = amountKas.split(".");
  if (decimalPart.length > MAX_DECIMAL_PLACES) {
    throw new Error("Invalid KAS amount.");
  }

  const sompi = BigInt(wholePart) * SOMPI_PER_KAS + BigInt(decimalPart.padEnd(8, "0") || "0");
  if (sompi <= 0n) {
    throw new Error("Invalid KAS amount.");
  }

  return sompi;
}

function formatClientSompiToKaspa(sompi: bigint): string {
  const normalizedWholePart = sompi / SOMPI_PER_KAS;
  const normalizedDecimalPart = sompi % SOMPI_PER_KAS;

  if (normalizedDecimalPart === 0n) {
    return normalizedWholePart.toString();
  }

  return `${normalizedWholePart}.${normalizedDecimalPart
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "")}`;
}

function normalizeKasAmount(amountKas: string): string {
  const sompi = parseClientKasAmountToSompi(amountKas);
  if (sompi < MIN_RELIABLE_MAINNET_OUTPUT_SOMPI) {
    throw new AmountTooSmallError();
  }

  return formatClientSompiToKaspa(sompi);
}

function isKasAmountBelowReliableMinimum(amountKas: null | string): boolean {
  if (!amountKas) {
    return false;
  }

  try {
    return parseClientKasAmountToSompi(amountKas) < MIN_RELIABLE_MAINNET_OUTPUT_SOMPI;
  } catch {
    return false;
  }
}

function getWalletLaunchUnavailableMessage(
  preview: null | PaymentUriPreview,
  amountTooSmall = false,
): string {
  if (amountTooSmall || preview?.error === "TOO_SMALL") {
    return getMainnetOutputMinimumMessage("Payment amount");
  }
  if (preview?.error === "INVALID") {
    return "Enter a valid KAS amount so the wallet link can include it.";
  }

  return "Enter an amount first so the wallet link can include it.";
}

function getAmountInputPrompt(preview: null | PaymentUriPreview, amountTooSmall = false): string {
  if (amountTooSmall || preview?.error === "TOO_SMALL") {
    return `Minimum ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS`;
  }
  if (preview?.error === "INVALID") {
    return "Enter a valid amount";
  }

  return "Enter amount";
}

function buildClientPaymentUri(input: {
  amountKas: string;
  label: string;
  message: null | string;
  recipientAddress: string;
}): string {
  const parts = [`amount=${encodeURIComponent(input.amountKas)}`];
  appendClientUriTextParam(parts, "label", input.label);
  appendClientUriTextParam(parts, "message", input.message);

  return `${input.recipientAddress}?${parts.join("&")}`;
}

function appendClientUriTextParam(parts: string[], key: string, value: null | string) {
  const trimmed = value?.trim();

  if (trimmed) {
    parts.push(`${key}=${encodeURIComponent(trimmed)}`);
  }
}

function statusClass(status: SerializedPaymentRequest["status"]): string {
  switch (status) {
    case "CONFIRMED":
      return "status-pill status-confirmed";
    case "EXPIRED":
      return "status-pill status-expired";
    case "FAILED":
      return "status-pill status-failed";
    default:
      return "status-pill status-pending";
  }
}

function kaspaStreamTransactionUrl(
  txId: null | string,
  network: PublicActionMetadata["network"],
): null | string {
  if (network !== "mainnet" || !txId || !/^[0-9a-f]+$/i.test(txId)) {
    return null;
  }

  return `https://kaspa.stream/transactions/${encodeURIComponent(txId)}`;
}

function humanActionType(type: string): string {
  switch (type) {
    case "kaspa.tip":
      return "Tip";
    case "kaspa.donation":
      return "Donation";
    case "kaspa.invoice":
      return "Invoice";
    case "kaspa.transfer":
      return "Transfer";
    case "kaspa.goal":
      return "Goal";
    default:
      return type;
  }
}

function compactAddress(address: string): string {
  if (address.length <= 28) {
    return address;
  }
  return `${address.slice(0, 14)}...${address.slice(-10)}`;
}

function compactTxId(txId: string): string {
  if (txId.length <= 20) {
    return txId;
  }
  return `${txId.slice(0, 10)}...${txId.slice(-8)}`;
}

function useQrDataUrl(value: null | string): null | string {
  const [dataUrl, setDataUrl] = useState<null | string>(null);

  useEffect(() => {
    if (!value) {
      setDataUrl(null);
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(value, {
      color: {
        dark: "#2a8e84",
        light: "#ffffff",
      },
      errorCorrectionLevel: "H",
      margin: 2,
      width: 480,
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

function useIsTouchOnly(): boolean {
  const [isTouchOnly, setIsTouchOnly] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setIsTouchOnly(query.matches);
    update();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isTouchOnly;
}

export function ActionPaymentFlow({
  action,
  goalProgress = null,
  paymentUri,
}: ActionPaymentFlowProps) {
  const [paymentRequest, setPaymentRequest] = useState<null | SerializedPaymentRequest>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [copied, setCopied] = useState<CopyState>(null);
  const [paying, setPaying] = useState(false);
  const [payStatus, setPayStatus] = useState<null | string>(null);
  const [sentTxId, setSentTxId] = useState<null | string>(null);
  const [awaitingKaswareConfirmation, setAwaitingKaswareConfirmation] = useState(false);
  const [awaitingMobileWalletConfirmation, setAwaitingMobileWalletConfirmation] = useState(false);
  const [openingMobileWallet, setOpeningMobileWallet] = useState(false);
  const [supporterAmountKas, setSupporterAmountKas] = useState("");
  const [supporterMessage, setSupporterMessage] = useState("");
  const [supporterName, setSupporterName] = useState("");
  const [supporterPublic, setSupporterPublic] = useState(false);
  const [supporterMessageSaveState, setSupporterMessageSaveState] =
    useState<SupporterMessageSaveState>("idle");
  const [walletOpenAttempted, setWalletOpenAttempted] = useState(false);
  const [kaswareConnection, setKaswareConnection] = useState<KaswareConnectionState>({
    account: null,
    checked: false,
    connected: false,
    installed: false,
    network: "unknown",
  });
  const kasUsdPrice = useKasUsdPrice();
  const pollRef = useRef<null | number>(null);
  const supporterMessageSaveTimerRef = useRef<null | number>(null);
  const isTouchOnly = useIsTouchOnly();
  const isVariableAmount = action.amountSompi === null;
  const goalIsClosed = Boolean(action.goalAutoClose && goalProgress?.reached);

  const currentUri = paymentRequest?.paymentUri ?? (isVariableAmount ? null : paymentUri);
  const variablePreview = useMemo<PaymentUriPreview | null>(() => {
    if (!isVariableAmount || paymentRequest) {
      return null;
    }

    return buildVariablePaymentUriPreview({
      amountKas: supporterAmountKas,
      label: action.title,
      message: action.message,
      recipientAddress: action.recipientAddress,
    });
  }, [
    action.message,
    action.recipientAddress,
    action.title,
    isVariableAmount,
    paymentRequest,
    supporterAmountKas,
  ]);
  const walletUri = currentUri ?? variablePreview?.uri ?? null;
  const walletLaunchAmountKas =
    paymentRequest?.amountKas ?? action.amountKas ?? variablePreview?.amountKas ?? null;
  const walletLaunchAmountTooSmall = isKasAmountBelowReliableMinimum(walletLaunchAmountKas);
  const walletLaunchUri =
    walletUri && !walletLaunchAmountTooSmall
      ? buildWalletLaunchUri({
          amountKas: walletLaunchAmountKas,
          recipientAddress: action.recipientAddress,
        })
      : null;
  const qrTarget =
    walletLaunchUri ??
    (isVariableAmount && !paymentRequest && variablePreview?.error === "EMPTY"
      ? action.recipientAddress
      : null);
  const qrDataUrl = useQrDataUrl(qrTarget);

  const copyEverythingBundle = useCallback(() => {
    if (!walletLaunchUri) return;
    const text = buildWalletFallbackText({
      amountKas: walletLaunchAmountKas,
      message: action.message,
      recipientAddress: action.recipientAddress,
      uri: walletLaunchUri,
    });
    void copyToClipboard(text).then((ok) => {
      if (ok) {
        setCopied({ at: Date.now(), key: "bundle" });
        window.setTimeout(() => {
          setCopied((current) => (current && current.key === "bundle" ? null : current));
        }, 1500);
      }
    });
  }, [
    action.amountKas,
    action.message,
    action.recipientAddress,
    walletLaunchAmountKas,
    walletLaunchUri,
  ]);

  const copy = useCallback(async (key: string, value: string) => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied({ at: Date.now(), key });
      window.setTimeout(() => {
        setCopied((current) => (current && current.key === key ? null : current));
      }, 1_500);
    } else {
      setError("Could not copy automatically — long-press the value and copy by hand.");
    }
  }, []);

  const requestPaymentRequest = useCallback(async (): Promise<null | SerializedPaymentRequest> => {
    if (goalIsClosed) {
      setError("This goal has reached its target and is closed for new contributions.");
      return null;
    }
    if (walletLaunchAmountTooSmall) {
      setError(getMainnetOutputMinimumMessage("Payment amount"));
      return null;
    }

    setCreating(true);
    setError(null);
    try {
      const body: {
        amountKas?: string;
        supporterMessage?: string;
        supporterName?: string;
        supporterPublic?: boolean;
      } = {};
      if (isVariableAmount && supporterAmountKas.trim().length > 0) {
        body.amountKas = normalizeLocalizedKasAmountInput(supporterAmountKas.trim());
      }
      if (supporterMessage.trim().length > 0) {
        body.supporterMessage = supporterMessage.trim();
      }
      if (supporterPublic) {
        body.supporterPublic = true;
        if (supporterName.trim().length > 0) {
          body.supporterName = supporterName.trim();
        }
      }
      const response = await fetch(`/api/actions/${action.publicId}/payment-requests`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setError(responseBody?.error?.message ?? "Could not create payment request.");
        return null;
      }
      const nextPaymentRequest = responseBody.paymentRequest as SerializedPaymentRequest;
      setPaymentRequest(nextPaymentRequest);
      if (nextPaymentRequest.supporterMessage || nextPaymentRequest.supporterPublic) {
        setSupporterMessageSaveState("saved");
      }
      return nextPaymentRequest;
    } catch {
      setError("Network error while creating the payment request.");
      return null;
    } finally {
      setCreating(false);
    }
  }, [
    action.publicId,
    goalIsClosed,
    isVariableAmount,
    supporterAmountKas,
    supporterMessage,
    supporterName,
    supporterPublic,
    walletLaunchAmountTooSmall,
  ]);

  const syncSupporterMessage = useCallback(async () => {
    if (!paymentRequest || paymentRequest.status !== "PENDING") {
      return;
    }

    const nextSupporterMessage = supporterMessage.trim() || null;
    const nextSupporterPublic = supporterPublic;
    const nextSupporterName = nextSupporterPublic ? supporterName.trim() || null : null;

    if (
      nextSupporterMessage === paymentRequest.supporterMessage &&
      nextSupporterName === paymentRequest.supporterName &&
      nextSupporterPublic === paymentRequest.supporterPublic
    ) {
      return;
    }

    setSupporterMessageSaveState("saving");
    try {
      const response = await fetch(`/api/payment-requests/${paymentRequest.id}/supporter-message`, {
        body: JSON.stringify({
          supporterMessage: nextSupporterMessage,
          supporterName: nextSupporterName,
          supporterPublic: nextSupporterPublic,
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const body = await response.json();
      if (!response.ok) {
        setSupporterMessageSaveState("error");
        setError(body?.error?.message ?? "Could not save the supporter note.");
        return;
      }
      setPaymentRequest(body.paymentRequest as SerializedPaymentRequest);
      setSupporterMessageSaveState("saved");
    } catch {
      setSupporterMessageSaveState("error");
      setError("Network error while saving the supporter note.");
    }
  }, [paymentRequest, supporterMessage, supporterName, supporterPublic]);

  useEffect(() => {
    if (supporterMessageSaveState !== "saved") {
      return;
    }

    if (supporterMessageSaveTimerRef.current !== null) {
      window.clearTimeout(supporterMessageSaveTimerRef.current);
    }

    supporterMessageSaveTimerRef.current = window.setTimeout(() => {
      setSupporterMessageSaveState("idle");
      supporterMessageSaveTimerRef.current = null;
    }, 1_800);

    return () => {
      if (supporterMessageSaveTimerRef.current !== null) {
        window.clearTimeout(supporterMessageSaveTimerRef.current);
        supporterMessageSaveTimerRef.current = null;
      }
    };
  }, [supporterMessageSaveState]);

  // Fixed-amount links prepare the request immediately so QR scans and status
  // polling are ready without an extra tap. If the supporter later adds a note,
  // the pending request can update it separately.
  const autoGenerateAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoGenerateAttemptedRef.current) return;
    if (isVariableAmount) return;
    if (paymentRequest) return;
    if (creating) return;
    autoGenerateAttemptedRef.current = true;
    void requestPaymentRequest();
  }, [creating, isVariableAmount, paymentRequest, requestPaymentRequest]);

  const payWithKasware = useCallback(async () => {
    setPayStatus(null);
    setSentTxId(null);
    setAwaitingKaswareConfirmation(false);

    if (isVariableAmount && !paymentRequest && supporterAmountKas.trim().length === 0) {
      setPayStatus("Enter an amount first so KasWare can receive the exact payment intent.");
      return;
    }
    if (walletLaunchAmountTooSmall) {
      setPayStatus(getMainnetOutputMinimumMessage("Payment amount"));
      return;
    }

    const provider = getKaswareProvider();
    if (!provider) {
      setPayStatus(
        "KasWare not detected. Connect the browser extension above, or copy the address into another wallet.",
      );
      return;
    }

    let walletNetwork: Awaited<ReturnType<typeof readKaswareNetwork>>;
    try {
      walletNetwork = await readKaswareNetwork(provider);
    } catch {
      setPayStatus("Could not verify the KasWare network. No payment was sent.");
      return;
    }

    if (walletNetwork === "unknown") {
      setPayStatus(
        `KasWare network could not be verified. Switch KasWare to ${action.network} and try again.`,
      );
      return;
    }

    if (walletNetwork !== action.network) {
      setPayStatus(
        `Switch KasWare to ${action.network} before paying. It is currently on ${walletNetwork}.`,
      );
      return;
    }

    let request = paymentRequest;
    if (request) {
      await syncSupporterMessage();
    } else {
      request = await requestPaymentRequest();
    }
    if (!request) {
      setPayStatus("Could not create the payment request. No payment was sent.");
      return;
    }

    const sompiSource = request.amountSompi ?? action.amountSompi;
    if (!sompiSource) {
      setPayStatus("Pay with KasWare needs an exact KAS amount.");
      return;
    }

    setPaying(true);
    try {
      const result = await sendKaspaPayment(provider, {
        amountSompi: BigInt(sompiSource),
        toAddress: action.recipientAddress,
      });
      setSentTxId(result.txId);
      setAwaitingKaswareConfirmation(true);
      setPayStatus(
        result.txId
          ? "Transaction broadcasted. The status will flip to CONFIRMED automatically once the indexer sees it."
          : "Wallet request completed. Waiting for on-chain confirmation from the Kaspa network.",
      );
    } catch (err) {
      const message =
        err instanceof WalletAdapterError
          ? err.message
          : "KasWare did not complete the send. No payment was made.";
      setPayStatus(message);
    } finally {
      setPaying(false);
    }
  }, [
    action.amountSompi,
    action.network,
    action.recipientAddress,
    isVariableAmount,
    paymentRequest,
    requestPaymentRequest,
    supporterAmountKas,
    syncSupporterMessage,
    walletLaunchAmountTooSmall,
  ]);

  const openMobileWallet = useCallback(async () => {
    setError(null);
    setPayStatus(null);

    if (!walletLaunchUri) {
      setError(getWalletLaunchUnavailableMessage(variablePreview, walletLaunchAmountTooSmall));
      return;
    }

    setOpeningMobileWallet(true);
    let request = paymentRequest;
    try {
      if (!request) {
        request = await requestPaymentRequest();
        if (!request) {
          setPayStatus("Could not create the payment request. Wallet was not opened.");
          return;
        }
      } else {
        await syncSupporterMessage();
      }

      const launchUri = buildWalletLaunchUri({
        amountKas: request.amountKas ?? walletLaunchAmountKas,
        recipientAddress: action.recipientAddress,
      });

      setWalletOpenAttempted(true);
      setAwaitingMobileWalletConfirmation(true);
      setPayStatus(
        "Wallet opened. If you send the payment, this page will update automatically after the network sees it.",
      );

      await copyToClipboard(
        buildWalletFallbackText({
          amountKas: request.amountKas ?? walletLaunchAmountKas,
          message: action.message,
          recipientAddress: action.recipientAddress,
          uri: launchUri,
        }),
      );

      window.location.href = launchUri;
    } finally {
      setOpeningMobileWallet(false);
    }
  }, [
    action.message,
    action.recipientAddress,
    paymentRequest,
    requestPaymentRequest,
    syncSupporterMessage,
    variablePreview?.error,
    walletLaunchAmountTooSmall,
    walletLaunchAmountKas,
    walletLaunchUri,
  ]);

  const rememberWalletOpen = useCallback(() => {
    setError(null);
    void syncSupporterMessage();

    if (!walletLaunchUri) {
      setError(getWalletLaunchUnavailableMessage(variablePreview, walletLaunchAmountTooSmall));
      return;
    }

    void copyToClipboard(
      buildWalletFallbackText({
        amountKas: walletLaunchAmountKas,
        message: action.message,
        recipientAddress: action.recipientAddress,
        uri: walletLaunchUri,
      }),
    );

    setWalletOpenAttempted(true);

    if (!paymentRequest) {
      void requestPaymentRequest();
    }
  }, [
    action.amountKas,
    action.message,
    action.recipientAddress,
    paymentRequest,
    requestPaymentRequest,
    syncSupporterMessage,
    variablePreview?.error,
    walletLaunchAmountTooSmall,
    walletLaunchAmountKas,
    walletLaunchUri,
  ]);

  // Single status fetch the polling effect + the post-broadcast fast-poll both
  // call into. Pulled out so we can fire it ad-hoc when the user signs.
  const pollPaymentRequestStatus = useCallback(
    async (paymentRequestId: string, reportedTxId: null | string) => {
      try {
        const query = reportedTxId ? `?txId=${encodeURIComponent(reportedTxId)}` : "";
        const response = await fetch(`/api/payment-requests/${paymentRequestId}/status${query}`);
        if (!response.ok) return;
        const body = await response.json();
        setPaymentRequest(body.paymentRequest as SerializedPaymentRequest);
      } catch {
        /* keep polling, transient error */
      }
    },
    [],
  );

  useEffect(() => {
    if (!paymentRequest || paymentRequest.status !== "PENDING") {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const id = window.setInterval(() => {
      void pollPaymentRequestStatus(paymentRequest.id, sentTxId);
    }, POLL_INTERVAL_MS);
    pollRef.current = id;

    return () => {
      window.clearInterval(id);
      pollRef.current = null;
    };
  }, [paymentRequest, pollPaymentRequestStatus, sentTxId]);

  // Fast-poll right after KasWare accepts the send flow — Kaspa confirms
  // quickly, so the indexer often has the receipt before the regular 1.5s tick
  // fires. Without this, the user stares at the waiting hero for an
  // arbitrary slice of the polling cycle.
  useEffect(() => {
    if (!awaitingKaswareConfirmation || !paymentRequest || paymentRequest.status !== "PENDING") {
      return;
    }
    const handle = window.setTimeout(() => {
      void pollPaymentRequestStatus(paymentRequest.id, sentTxId);
    }, POST_BROADCAST_FAST_POLL_MS);
    return () => window.clearTimeout(handle);
  }, [awaitingKaswareConfirmation, paymentRequest, pollPaymentRequestStatus, sentTxId]);

  // Mobile wallets background the browser. Poll once immediately when the
  // supporter returns so they don't wait for a throttled background interval.
  useEffect(() => {
    if (!paymentRequest || paymentRequest.status !== "PENDING") {
      return;
    }

    const pollWhenVisible = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void pollPaymentRequestStatus(paymentRequest.id, sentTxId);
    };

    window.addEventListener("focus", pollWhenVisible);
    document.addEventListener("visibilitychange", pollWhenVisible);

    return () => {
      window.removeEventListener("focus", pollWhenVisible);
      document.removeEventListener("visibilitychange", pollWhenVisible);
    };
  }, [paymentRequest, pollPaymentRequestStatus, sentTxId]);

  useEffect(() => {
    if (paymentRequest && paymentRequest.status !== "PENDING") {
      setAwaitingKaswareConfirmation(false);
      setAwaitingMobileWalletConfirmation(false);
    }
  }, [paymentRequest]);

  const currentStatus = paymentRequest?.status ?? "PENDING";
  const isConfirmed = paymentRequest?.status === "CONFIRMED";
  const isPending = paymentRequest === null || paymentRequest.status === "PENDING";
  const effectiveAmountKas =
    paymentRequest?.amountKas ?? action.amountKas ?? variablePreview?.amountKas ?? null;
  const effectiveAmountUsdEstimate = formatApproxUsdValue(effectiveAmountKas, kasUsdPrice);
  const supporterAmountUsdEstimate = formatApproxUsdValue(supporterAmountKas, kasUsdPrice);
  const amountUsdMeta = formatApproxUsdMeta(kasUsdPrice);
  const showKaswarePay = isPending && !goalIsClosed && !isTouchOnly;
  const paymentRequestExplorerUrl = kaspaStreamTransactionUrl(
    paymentRequest?.txId ?? null,
    action.network,
  );
  const sentTxExplorerUrl = kaspaStreamTransactionUrl(sentTxId, action.network);
  const kaswareNeedsAmount =
    walletLaunchAmountTooSmall ||
    (isVariableAmount && !paymentRequest && supporterAmountKas.trim().length === 0);
  // When the creator flagged this Action as `noteRequired`, the Pay button
  // and the deep-link / QR open-wallet button stay disabled until the
  // supporter has typed a note that meets the minimum length. A single
  // character would trivially bypass the gate, so we require ≥10 chars
  // (after trim). Server side enforces the same limit defence-in-depth.
  const noteRequired = action.noteRequired === true;
  const noteTrimmedLength = supporterMessage.trim().length;
  const noteMissing = noteRequired && noteTrimmedLength < MIN_REQUIRED_NOTE_LENGTH;
  const noteCharsRemaining = Math.max(0, MIN_REQUIRED_NOTE_LENGTH - noteTrimmedLength);
  const waitingForKaswareConfirmation =
    awaitingKaswareConfirmation && paymentRequest?.status === "PENDING";
  const waitingForMobileWalletConfirmation =
    awaitingMobileWalletConfirmation && isTouchOnly && paymentRequest?.status === "PENDING";

  const successTxId = paymentRequest?.txId ?? paymentRequest?.fakeTxId ?? null;
  const successExplorerUrl = paymentRequest?.txId ? paymentRequestExplorerUrl : null;
  const successAmountKas =
    paymentRequest?.amountKas ?? action.amountKas ?? variablePreview?.amountKas ?? null;
  const successAmountUsdEstimate = formatApproxUsdValue(successAmountKas, kasUsdPrice);
  const humanType = humanActionType(action.type);

  // Show a dedicated waiting hero once KasWare has accepted the send flow
  // but the indexer hasn't yet flipped the PaymentRequest to CONFIRMED.
  // This replaces the entire pay-card — by this point the user has nothing
  // left to do, so QR / KasWare / copy buttons would only be noise.
  const showWaitingHero = waitingForKaswareConfirmation || waitingForMobileWalletConfirmation;

  return (
    <main className="pay-layout">
      {/* Link header — type pill, title, description, message */}
      <section className="card link-header">
        <span className="link-type-pill">{humanType}</span>
        <h1>{action.title}</h1>
        {action.description ? <p>{action.description}</p> : null}
        {action.message ? <p className="muted">&ldquo;{action.message}&rdquo;</p> : null}
      </section>

      {isConfirmed ? (
        /* Success hero — replaces the pay surface once the payment lands */
        <section className="card pay-success" key="success">
          <div className="pay-success-check" aria-hidden="true">
            <svg
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              viewBox="0 0 24 24"
            >
              <polyline points="5 13 10 18 19 7" />
            </svg>
          </div>
          <h2 className="pay-success-title">Thank you!</h2>
          {successAmountKas ? (
            <p className="pay-success-amount">
              <strong>{successAmountKas}</strong> <span>KAS received</span>
            </p>
          ) : (
            <p className="pay-success-amount">Payment received</p>
          )}
          {successAmountUsdEstimate ? (
            <p className="amount-usd-estimate pay-amount-usd">
              {successAmountUsdEstimate} at current KAS price
            </p>
          ) : null}
          <p className="muted" style={{ margin: "4px 0 18px" }}>
            {paymentRequest?.detectionSource === "mock"
              ? "Confirmed via mock-confirm (test mode)."
              : "Confirmed on the Kaspa network."}
          </p>
          {successTxId ? (
            <div className="pay-success-tx">
              <span className="label">Transaction</span>
              <p className="value-mono" style={{ margin: "4px 0 0" }}>
                {compactTxId(successTxId)}
                {successExplorerUrl ? (
                  <>
                    {" · "}
                    <a href={successExplorerUrl} rel="noreferrer" target="_blank">
                      View on Kaspa.stream
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          ) : null}
          {paymentRequest?.supporterMessage ? (
            <div className="pay-success-note">
              <span className="label">Your note</span>
              <p>&ldquo;{paymentRequest.supporterMessage}&rdquo;</p>
              <p className="muted pay-success-note-disclaimer">
                Off-chain only. This note is not written into the Kaspa transaction.
              </p>
            </div>
          ) : null}
          {paymentRequest?.supporterPublic ? (
            <p className="pay-success-wall-note">
              Shared on the public supporter wall as{" "}
              <strong>{paymentRequest.supporterName ?? "Anonymous"}</strong>.
            </p>
          ) : null}
        </section>
      ) : showWaitingHero ? (
        /* Waiting hero — replaces the pay surface from the moment the user
           signs in KasWare until the indexer flips status to CONFIRMED.
           No QR / button / copy at this stage because the supporter has
           nothing left to do. */
        <section className="card pay-waiting" key="waiting" role="status" aria-live="polite">
          <div className="pay-waiting-spinner" aria-hidden="true" />
          <h2 className="pay-waiting-title">
            {waitingForKaswareConfirmation
              ? "Waiting for the Kaspa network…"
              : "Waiting for wallet payment…"}
          </h2>
          {successAmountKas ? (
            <p className="pay-waiting-amount">
              <strong>{successAmountKas}</strong>{" "}
              <span>{waitingForKaswareConfirmation ? "KAS sent" : "KAS requested"}</span>
            </p>
          ) : (
            <p className="pay-waiting-amount">
              {waitingForKaswareConfirmation ? "Transaction broadcast" : "Payment request pending"}
            </p>
          )}
          {successAmountUsdEstimate ? (
            <p className="amount-usd-estimate pay-amount-usd">
              {successAmountUsdEstimate} at current KAS price
            </p>
          ) : null}
          <p className="muted pay-waiting-hint">
            {waitingForKaswareConfirmation
              ? "Your wallet signed and the transaction is in flight. Confirmation usually arrives in a few seconds and the page updates automatically."
              : "If you completed the send in Kaspium, keep this page open. It checks the network as soon as you return and updates automatically."}
          </p>
          {sentTxId ? (
            <div className="pay-waiting-tx">
              <span className="label">Transaction</span>
              <p className="value-mono" style={{ margin: "4px 0 0" }}>
                {compactTxId(sentTxId)}
                {sentTxExplorerUrl ? (
                  <>
                    {" · "}
                    <a href={sentTxExplorerUrl} rel="noreferrer" target="_blank">
                      View on Kaspa.stream
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          ) : null}
          {paymentRequest?.supporterMessage ? (
            <div className="pay-waiting-note">
              <span className="label">Your note</span>
              <p>&ldquo;{paymentRequest.supporterMessage}&rdquo;</p>
              <p className="muted pay-success-note-disclaimer">
                Off-chain only. This note is not written into the Kaspa transaction.
              </p>
            </div>
          ) : null}
          {waitingForMobileWalletConfirmation ? (
            <div className="mobile-fallback mobile-fallback-waiting">
              <span className="label">Nothing happened in the wallet?</span>
              <p style={{ margin: "6px 0 8px" }}>
                We copied the address + amount to your clipboard. If Kaspium opened blank, fully
                close Kaspium, open it again, and try the wallet link once more — or paste the
                payment details manually.
              </p>
              <div className="row mobile-fallback-actions">
                <button
                  className="btn"
                  disabled={openingMobileWallet}
                  onClick={() => void openMobileWallet()}
                  type="button"
                >
                  {openingMobileWallet ? "Opening…" : "Reopen wallet"}
                </button>
                <button className="btn" onClick={copyEverythingBundle} type="button">
                  {copied?.key === "bundle" ? "Copied" : "Copy everything"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        /* Consolidated pay surface — amount, recipient and pay methods in one card */
        <section className="card pay-card" key="pay">
          {/* Goal progress — only for goal links. Raised / target / percent /
              supporter count are computed server-side from CONFIRMED payments
              so the heavy kaspa-wasm math never reaches the client bundle. */}
          {goalProgress ? (
            <div className={`goal-progress${goalProgress.reached ? " goal-progress-reached" : ""}`}>
              <div className="goal-progress-stats">
                <span className="goal-progress-raised">
                  <strong>{goalProgress.raisedKas}</strong> KAS
                </span>
                <span className="goal-progress-goal">of {goalProgress.goalKas} KAS goal</span>
              </div>
              <div
                className="goal-progress-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={goalProgress.pct}
                aria-label="Fundraising progress"
              >
                <div
                  className={`goal-progress-fill${goalProgress.reached ? " goal-progress-fill-reached" : ""}`}
                  style={{ width: `${goalProgress.pct}%` }}
                />
              </div>
              <div className="goal-progress-meta">
                <span className="goal-progress-pct">{goalProgress.pctLabel}% funded</span>
                <span className="goal-progress-supporters">
                  {goalProgress.supporterCount}{" "}
                  {goalProgress.supporterCount === 1 ? "supporter" : "supporters"}
                </span>
              </div>
              {goalProgress.reached ? (
                <p className="goal-progress-reached-note">
                  {action.goalAutoClose
                    ? "Goal reached — this link is now closed for new contributions."
                    : "Goal reached — contributions are still welcome."}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Amount */}
          <div className="pay-amount">
            {!isVariableAmount ? (
              <>
                <span className="label">Amount</span>
                <div className="amount-display amount-display-large">
                  <span className="amount-main">{action.amountKas}</span>
                  <span className="amount-unit">KAS</span>
                </div>
                {effectiveAmountUsdEstimate ? (
                  <p className="amount-usd-estimate">
                    {effectiveAmountUsdEstimate} at current KAS price
                  </p>
                ) : null}
              </>
            ) : paymentRequest ? (
              <>
                <span className="label">Amount</span>
                <div className="amount-display amount-display-large">
                  <span className="amount-main">{paymentRequest.amountKas ?? "Any amount"}</span>
                  {paymentRequest.amountKas ? <span className="amount-unit">KAS</span> : null}
                </div>
                {effectiveAmountUsdEstimate ? (
                  <p className="amount-usd-estimate">
                    {effectiveAmountUsdEstimate} at current KAS price
                  </p>
                ) : null}
                {!paymentRequest.amountKas ? (
                  <p className="muted" style={{ margin: "2px 0 0", fontSize: "0.82rem" }}>
                    Choose inside your wallet
                  </p>
                ) : null}
              </>
            ) : goalIsClosed ? (
              <>
                <span className="label">Amount</span>
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  This goal reached its target, so new contributions are closed.
                </p>
              </>
            ) : (
              <>
                <label className="label" htmlFor="pay-amount-input">
                  Pick an amount
                </label>
                <input
                  aria-label="Amount in KAS"
                  id="pay-amount-input"
                  inputMode="decimal"
                  onChange={(event) => setSupporterAmountKas(event.target.value)}
                  placeholder="e.g. 10"
                  type="text"
                  value={supporterAmountKas}
                />
                <p className="muted" style={{ margin: "8px 0 0", fontSize: "0.85rem" }}>
                  The creator left the amount open. Pick a value, or leave blank to set it in your
                  wallet.
                </p>
                {supporterAmountUsdEstimate ? (
                  <p className="amount-usd-estimate pay-amount-usd">
                    {amountUsdMeta}: {supporterAmountUsdEstimate}
                  </p>
                ) : null}
                {variablePreview?.error === "TOO_SMALL" ? (
                  <p className="form-field-help form-field-warn" style={{ marginTop: 8 }}>
                    {getMainnetOutputMinimumMessage("Payment amount")}
                  </p>
                ) : null}
              </>
            )}
            {walletLaunchAmountTooSmall && variablePreview?.error !== "TOO_SMALL" ? (
              <p className="form-field-help form-field-warn" style={{ marginTop: 8 }}>
                {getMainnetOutputMinimumMessage("Payment amount")}
              </p>
            ) : null}
          </div>

          {isPending && !goalIsClosed ? (
            <div
              className={`pay-supporter-note${noteRequired ? " pay-supporter-note-required" : ""}`}
            >
              <label className="label" htmlFor="supporter-message">
                {noteRequired ? (
                  <>
                    Note to creator <span className="pay-supporter-note-required-mark">*</span>
                  </>
                ) : (
                  "Optional note to creator"
                )}
              </label>
              <textarea
                aria-required={noteRequired || undefined}
                id="supporter-message"
                maxLength={280}
                onChange={(event) => {
                  setSupporterMessage(event.target.value);
                  setSupporterMessageSaveState("idle");
                }}
                onBlur={() => void syncSupporterMessage()}
                placeholder={
                  noteRequired
                    ? `Required — at least ${MIN_REQUIRED_NOTE_LENGTH} characters describing what this payment is for`
                    : "Thanks for the stream"
                }
                required={noteRequired}
                rows={3}
                value={supporterMessage}
              />
              <div className="supporter-wall-opt-in">
                <label className="supporter-wall-checkbox">
                  <input
                    checked={supporterPublic}
                    onChange={(event) => {
                      setSupporterPublic(event.target.checked);
                      setSupporterMessageSaveState("idle");
                    }}
                    type="checkbox"
                  />
                  <span>
                    Show this on the creator&apos;s public supporter wall after confirmation
                  </span>
                </label>
                <p className="muted">
                  Public wall entries show your display name, amount, and note. Wallet addresses are
                  never shown.
                </p>
                {supporterPublic ? (
                  <div className="supporter-wall-name-field">
                    <label className="label" htmlFor="supporter-name">
                      Display name
                    </label>
                    <input
                      id="supporter-name"
                      maxLength={40}
                      onBlur={() => void syncSupporterMessage()}
                      onChange={(event) => {
                        setSupporterName(event.target.value);
                        setSupporterMessageSaveState("idle");
                      }}
                      placeholder="Anonymous"
                      type="text"
                      value={supporterName}
                    />
                  </div>
                ) : null}
              </div>
              {noteRequired ? (
                <p
                  aria-live="polite"
                  className={`pay-supporter-note-counter${
                    noteMissing ? "" : " pay-supporter-note-counter-ok"
                  }`}
                >
                  {noteMissing
                    ? `${noteCharsRemaining} more character${noteCharsRemaining === 1 ? "" : "s"} to unlock the Pay button`
                    : `Looks good — note is long enough (${noteTrimmedLength} characters)`}
                </p>
              ) : null}
              <div className="pay-supporter-note-footer">
                <p className="muted">
                  {noteRequired
                    ? "The creator requires a note with this payment — they'll see it after confirmation. Off-chain only, not written into the Kaspa transaction."
                    : "Off-chain only. This note is shown to the creator after confirmation and is not written into the Kaspa transaction."}
                </p>
                {supporterMessageSaveState !== "idle" ? (
                  <span
                    className={`supporter-note-save-status supporter-note-save-status-${supporterMessageSaveState}`}
                    role="status"
                  >
                    {supporterMessageSaveState === "saving"
                      ? "Saving..."
                      : supporterMessageSaveState === "saved"
                        ? "Saved"
                        : "Save failed"}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Recipient — compact, inline copy */}
          <div className="pay-recipient">
            <span className="label">To</span>
            <div className="pay-recipient-row">
              <p className="value-mono" style={{ margin: 0 }}>
                {compactAddress(action.recipientAddress)}
              </p>
              <button
                className="link-card-inline-btn"
                onClick={() => copy("address", action.recipientAddress)}
                type="button"
              >
                {copied?.key === "address" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.78rem" }}>
              Always verify this address in your wallet before signing.
            </p>
          </div>

          <div className="pay-divider" />

          {/* Wallet connection helper (desktop only) */}
          {!isTouchOnly ? (
            <WalletConnectCard
              expectedNetwork={action.network}
              onStateChange={setKaswareConnection}
            />
          ) : null}

          {/* Primary CTA — adapts to device + state. Note: once KasWare
              accepts the send flow, the parent conditional
              swaps this whole pay-card for the waiting hero, so this
              branch only runs while the user is still in "choose how to
              pay" mode. */}
          {isPending && !goalIsClosed ? (
            <div className="pay-actions">
              {/* Mobile: deep-link */}
              {isTouchOnly ? (
                noteMissing ? (
                  /* Mobile: same note-required gate as desktop. The Pay-link
                     CTA is replaced by a disabled cousin until the supporter
                     writes a note above. */
                  <button className="btn btn-primary btn-block btn-pay" disabled type="button">
                    Add a note to pay
                  </button>
                ) : walletLaunchUri ? (
                  <button
                    className="btn btn-primary btn-block btn-pay"
                    disabled={openingMobileWallet || creating}
                    onClick={() => void openMobileWallet()}
                    type="button"
                  >
                    {openingMobileWallet || creating ? "Opening wallet…" : "Open in wallet"}
                  </button>
                ) : (
                  <button className="btn btn-primary btn-block btn-pay" disabled type="button">
                    {getAmountInputPrompt(variablePreview, walletLaunchAmountTooSmall)}
                  </button>
                )
              ) : null}

              {/* Mobile fallback — only show after the user has tried Open-in-wallet
                  at least once. Walks through the manual paste path when the deep
                  link gets swallowed by a backgrounded wallet (common on iOS). */}
              {isTouchOnly && walletOpenAttempted && walletLaunchUri ? (
                <div className="mobile-fallback">
                  <span className="label">Didn&apos;t the wallet pre-fill?</span>
                  <p style={{ margin: "6px 0 8px" }}>
                    We copied the address + amount to your clipboard. If Kaspium opened blank:
                  </p>
                  <ol className="mobile-fallback-steps">
                    <li>Long-press the recipient field in Kaspium → Paste</li>
                    <li>Check the amount matches</li>
                    <li>Tap Send</li>
                  </ol>
                  <div className="row mobile-fallback-actions">
                    <a className="btn" href={walletLaunchUri} onClick={rememberWalletOpen}>
                      Reopen in wallet
                    </a>
                    <button className="btn" onClick={copyEverythingBundle} type="button">
                      {copied?.key === "bundle" ? "Copied" : "Copy everything"}
                    </button>
                  </div>
                  <p
                    className="muted"
                    style={{ fontSize: "0.78rem", marginTop: 10, marginBottom: 0 }}
                  >
                    Mobile browsers sometimes drop the wallet handoff when Kaspium is sleeping in
                    the background. If &ldquo;Reopen&rdquo; keeps failing, fully close Kaspium from
                    the app switcher and try again — or paste from clipboard.
                  </p>
                </div>
              ) : null}

              {/* Desktop: KasWare button when connected */}
              {showKaswarePay && kaswareConnection.connected ? (
                <button
                  className="btn btn-primary btn-block btn-pay"
                  disabled={
                    paying ||
                    creating ||
                    kaswareNeedsAmount ||
                    // After a successful broadcast, lock the button until the
                    // indexer flips status to CONFIRMED (or it expires/fails).
                    // Without this guard a second click would open KasWare
                    // again for the same PaymentRequest — a real foot-gun
                    // because the user'd be signing twice for one intent.
                    waitingForKaswareConfirmation ||
                    noteMissing
                  }
                  onClick={payWithKasware}
                  type="button"
                >
                  {paying ? (
                    <span className="btn-pay-with-spinner">
                      <span className="btn-pay-spinner" aria-hidden="true" />
                      Confirm in KasWare…
                    </span>
                  ) : creating ? (
                    "Creating payment request…"
                  ) : waitingForKaswareConfirmation ? (
                    <span className="btn-pay-with-spinner">
                      <span className="btn-pay-spinner" aria-hidden="true" />
                      Waiting for confirmation…
                    </span>
                  ) : kaswareNeedsAmount ? (
                    getAmountInputPrompt(variablePreview, walletLaunchAmountTooSmall)
                  ) : noteMissing ? (
                    "Add a note to pay"
                  ) : (
                    "Pay with KasWare"
                  )}
                </button>
              ) : null}

              {/* QR — always visible while pending, smaller on desktop */}
              {qrDataUrl ? (
                <div className="pay-qr-block">
                  <span className="label">Or scan with a Kaspa wallet</span>
                  <div className="branded-qr-shell">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="Kaspa payment QR code" className="qr" src={qrDataUrl} />
                    <span className="branded-qr-mark" aria-hidden="true">
                      <LogoMark size={34} title={undefined} variant="solid" />
                    </span>
                  </div>
                </div>
              ) : isVariableAmount && !paymentRequest ? (
                <div className="pay-qr-block">
                  <span className="label">Or scan with a Kaspa wallet</span>
                  <div className="qr qr-placeholder" aria-hidden>
                    <span>{getAmountInputPrompt(variablePreview, walletLaunchAmountTooSmall)}</span>
                  </div>
                </div>
              ) : null}

              {/* Manual copy fallback */}
              <div className="pay-copy-row">
                {effectiveAmountKas ? (
                  <button
                    className="btn"
                    onClick={() => copy("amount", effectiveAmountKas)}
                    type="button"
                  >
                    {copied?.key === "amount" ? "Amount copied" : "Copy amount"}
                  </button>
                ) : null}
                {walletLaunchUri ? (
                  <button
                    className="btn"
                    onClick={() => copy("uri", walletLaunchUri)}
                    type="button"
                  >
                    {copied?.key === "uri" ? "URI copied" : "Copy URI"}
                  </button>
                ) : null}
              </div>

              {/* Status line — small, contextual */}
              {paymentRequest ? (
                <div className="pay-status-row">
                  <span className={statusClass(currentStatus)}>{currentStatus}</span>
                  <span className="muted" style={{ fontSize: "0.82rem" }}>
                    Status refreshes every few seconds.
                  </span>
                </div>
              ) : null}

              {/* Inline status messages from the pay flow. Once we've
                  broadcast, the prominent banner at the top of the pay
                  actions block already shows the same info — so suppress
                  the small redundant "broadcasted: <txid>" line and the
                  twin success-text duplicate to keep the surface calm. */}
              {payStatus && !sentTxId ? (
                <p className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>
                  {payStatus}
                </p>
              ) : null}
            </div>
          ) : goalIsClosed ? (
            <p className="muted" style={{ margin: 0 }}>
              This goal has reached its target and is closed for new contributions.
            </p>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              This payment request is no longer accepting payments.
            </p>
          )}

          {error ? (
            <p className="error-text" style={{ marginTop: 8 }}>
              {error}
            </p>
          ) : null}
        </section>
      )}

      <section className="card card-muted">
        <p className="muted" style={{ margin: 0 }}>
          Kaspa Links never holds funds. Payments go directly from your wallet to the address above.
          Status flips to CONFIRMED via on-chain detection — no admin button. Need KAS first?{" "}
          <a href="https://kaspa.org/hodl" rel="noreferrer noopener" target="_blank">
            See Kaspa&apos;s official buy-and-self-custody guide
          </a>
          .
        </p>
      </section>
    </main>
  );
}
