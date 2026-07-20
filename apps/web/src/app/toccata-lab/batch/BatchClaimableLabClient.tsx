"use client";

/* eslint-disable @next/next/no-img-element -- QR SVGs come from our validated internal endpoint. */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  getKaswareProvider,
  readKaswareBalance,
  readKaswareNetwork,
  sendKaspaPayment,
  WalletAdapterError,
} from "@kaspa-actions/wallet-adapter";

import { createToccataLabKeyPair } from "@/lib/toccata-lab-keys";
import {
  assertBatchMatchesRecoveryTarget,
  createBatchRecoveryBundle,
  parseBatchRecoveryBundle,
  readBatchRecoveryTarget,
  shortBatchReference,
  type BatchRecoveryTarget,
  type BatchRecoveryRecord,
} from "@/lib/batch-claimable-recovery";
import {
  isTerminalBatchChildStatus,
  reconcileBatchWithServer,
  sameBatchFundingMatch,
  type RegisteredBatchState,
} from "@/lib/batch-claimable-state";
import {
  BATCH_CLAIMABLE_STORAGE_KEY,
  buildBatchClaimUrl as buildClaimUrl,
  buildBatchRefundUrl as buildRefundUrl,
  saveBatchLinksToMyLinks,
} from "@/lib/batch-claimable-store";
import {
  readEncryptedLocalJson,
  removeEncryptedLocalJson,
  writeEncryptedLocalJson,
} from "@/lib/claimable-vault";
import {
  formatSompiForToccataLab,
  planToccataCanaryClaimFromNetKas,
  planToccataCanaryExpiry,
  TOCCATA_CANARY_DEFAULT_FEE_SOMPI,
  TOCCATA_CANARY_MIN_OUTPUT_SOMPI,
  type ToccataCanaryExpiryUnit,
} from "@/lib/toccata-lab-fee";
import { buildWalletLaunchUri } from "@/lib/wallet-uri";
import { estimateClaimableExpiry } from "@/lib/claimable-expiry";
import { FundingQrCode } from "@/lib/funding-qr";

import { SESSION_EVENT } from "../../BrandNav";
import { CreatorSignInGate } from "../../CreatorSignInGate";

import {
  buildBatchActivationSpendInBrowser,
  buildClaimableSpendInBrowser,
} from "../claimable-browser";
type Capabilities = { missing: string[]; ready: boolean; version: string };

type FundingMatch = {
  amountSompi: string;
  blockTime: null | number;
  outputIndex: number;
  transactionId: string;
};

type UnmatchedFundingOutput = {
  amountSompi: string;
  outputIndex: number;
  transactionId: string;
};

type BatchRecord = BatchRecoveryRecord;
type BatchLink = BatchRecord["links"][number];

type ScriptResponse = {
  scripts: Array<{
    fundingAddress: string;
    redeemScriptHex: string;
    scriptPublicKey: { script: string; version: number };
  }>;
};

const STORAGE_KEY = BATCH_CLAIMABLE_STORAGE_KEY;
const MAX_BATCH_SIZE = 10;
const BATCH_ACTIVATION_FEE_SOMPI = 1_000_000n;
const FUNDING_SAFE_CHANGE_SOMPI = 20_000_000n;
const FUNDING_AUTO_CHECK_MS = 5_000;
const FUNDED_RECONCILE_MS = 15_000;
const EXISTING_BATCH_ERROR =
  "A local batch already exists. Export its recovery bundle and clear it before creating another.";

export function BatchClaimableLabClient({
  capabilities,
  enabled,
  initialCount = 2,
  mode = "create",
}: {
  capabilities: Capabilities;
  enabled: boolean;
  initialCount?: number;
  mode?: "create" | "recovery";
}) {
  const safeInitialCount = Math.min(MAX_BATCH_SIZE, Math.max(2, Math.trunc(initialCount)));
  const [amountKas, setAmountKas] = useState("1");
  const [batch, setBatch] = useState<BatchRecord | null>(null);
  const [count, setCount] = useState(String(safeInitialCount));
  const [description, setDescription] = useState(
    "A Kaspa reward for the first person to claim it.",
  );
  const [error, setError] = useState("");
  const [expiryUnit, setExpiryUnit] = useState<ToccataCanaryExpiryUnit>("hours");
  const [expiryValue, setExpiryValue] = useState("24");
  const [feeKas, setFeeKas] = useState(formatSompiForToccataLab(TOCCATA_CANARY_DEFAULT_FEE_SOMPI));
  const [generating, setGenerating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [linkTitles, setLinkTitles] = useState(() => defaultLinkTitles(safeInitialCount));
  const [notice, setNotice] = useState("");
  const [creatorSignedIn, setCreatorSignedIn] = useState<null | boolean>(null);
  const [checking, setChecking] = useState(false);
  const [fundingWithKasware, setFundingWithKasware] = useState(false);
  const [isTouchOnly, setIsTouchOnly] = useState<null | boolean>(null);
  const [refundAddress, setRefundAddress] = useState("");
  const [showFundingQr, setShowFundingQr] = useState(false);
  const [title, setTitle] = useState("Community claim drop");
  const [showKaswareHelp, setShowKaswareHelp] = useState(false);
  const [unmatchedFundingOutputs, setUnmatchedFundingOutputs] = useState<UnmatchedFundingOutput[]>(
    [],
  );
  const [recoveringOutputId, setRecoveringOutputId] = useState("");
  const [recoveryTxId, setRecoveryTxId] = useState("");
  const fundingCheckInFlight = useRef(false);
  const batchActionInFlight = useRef<null | "activate" | "refund">(null);
  const batchRef = useRef<BatchRecord | null>(null);
  const batchReconcileInFlight = useRef<null | {
    batchId: string;
    promise: Promise<BatchRecord | null>;
    requestId: symbol;
  }>(null);

  // DAA-based expiry tracking (reused from main claimable lab for consistent UX)
  const [currentDaaScore, setCurrentDaaScore] = useState("");
  const [currentDaaLoadedAtMs, setCurrentDaaLoadedAtMs] = useState<null | number>(null);
  const [timerNowMs, setTimerNowMs] = useState(() => Date.now());

  // Safety confirmation for the non-custodial activation step
  const [activationConfirmed, setActivationConfirmed] = useState(false);
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showCreatedDialog, setShowCreatedDialog] = useState(false);
  const [claimQr, setClaimQr] = useState<null | {
    dataUrl: string;
    linkId: string;
    title: string;
  }>(null);
  const [claimQrLoadingId, setClaimQrLoadingId] = useState("");
  const recoveryInputRef = useRef<HTMLInputElement>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<BatchRecoveryTarget | null>(null);

  useEffect(() => {
    if (mode !== "recovery") return;
    setRecoveryTarget(readBatchRecoveryTarget(window.location.search));
  }, [mode]);

  useEffect(() => {
    void readEncryptedLocalJson<BatchRecord>(STORAGE_KEY).then(({ value }) => {
      if (value?.version === 2 && Array.isArray(value.links)) {
        batchRef.current = value;
        setBatch(value);
        setShowKaswareHelp(false);
        setShowFundingQr(false);
      }
    });
  }, []);

  useEffect(() => {
    setUnmatchedFundingOutputs([]);
    setRecoveringOutputId("");
    setRecoveryTxId("");
  }, [batch?.id]);

  useEffect(() => {
    const synchronizeVault = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      void readEncryptedLocalJson<BatchRecord>(STORAGE_KEY).then(({ value }) => {
        if (value?.version === 2 && Array.isArray(value.links)) {
          setBatch((current) => {
            const next =
              !current || (value.updatedAtMs ?? 0) >= (current.updatedAtMs ?? 0) ? value : current;
            batchRef.current = next;
            return next;
          });
        } else if (!value) {
          batchRef.current = null;
          setBatch(null);
        }
      });
    };
    window.addEventListener("storage", synchronizeVault);
    return () => window.removeEventListener("storage", synchronizeVault);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    setIsTouchOnly(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    if (mode === "recovery") return;
    const check = () => setCreatorSignedIn(readCreatorAuthHeaders() !== null);
    check();
    window.addEventListener(SESSION_EVENT, check);
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    return () => {
      window.removeEventListener(SESSION_EVENT, check);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
    };
  }, [mode]);

  // Reset activation safety checkbox when batch status changes
  useEffect(() => {
    setActivationConfirmed(false);
  }, [batch?.activation.status, batch?.id]);

  // Live timer for expiry countdown (non-custodial — only uses public DAA score)
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimerNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Re-anchor expiry against Kaspa DAA while setup is active. Activated batches
  // use a slower cadence so long-lived tabs still show a trustworthy deadline.
  useEffect(() => {
    if (!batch || (batch.activation.status === "refunded" && unmatchedFundingOutputs.length === 0))
      return;

    const fetchDaa = async () => {
      try {
        const res = await fetch("/api/toccata-lab/dag-info");
        const body = await res.json();
        if (res.ok && body.virtualDaaScore) {
          setCurrentDaaScore(body.virtualDaaScore);
          setCurrentDaaLoadedAtMs(Date.now());
        }
      } catch {
        // ignore transient fetch errors for background DAA
      }
    };

    void fetchDaa();
    const intervalMs = batch.activation.status === "activated" ? 120_000 : 30_000;
    const timer = window.setInterval(() => void fetchDaa(), intervalMs);
    return () => window.clearInterval(timer);
  }, [
    batch?.id,
    batch?.activation.status,
    batch?.batchManifestRegisteredAt,
    unmatchedFundingOutputs.length,
  ]);

  // Funding detection is only needed until the exact allocator output exists.
  // Later state changes are read from the registered batch endpoint below.
  useEffect(() => {
    if (!batch || batch.activation.status !== "awaiting_funding") return;

    const tick = (quiet = true) => void checkFunding({ quiet });
    const initial = window.setTimeout(() => tick(), 1_500);
    const timer = window.setInterval(() => tick(), FUNDING_AUTO_CHECK_MS);
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") tick(false);
    };

    window.addEventListener("focus", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [batch?.id, batch?.activation.status]);

  // Reconcile public server state after load/import/status changes. A funded
  // allocator is checked without rewriting unchanged browser-held recovery data.
  useEffect(() => {
    if (!batch?.batchManifestRegisteredAt) return;
    const reconcile = () =>
      void reconcileRegisteredBatch(undefined, {
        syncMyLinks: batch.activation.status === "activated",
      });
    reconcile();

    if (batch.activation.status === "awaiting_funding") return;

    const reconcileWhenVisible = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("focus", reconcileWhenVisible);
    document.addEventListener("visibilitychange", reconcileWhenVisible);
    const timer =
      batch.activation.status === "funded"
        ? window.setInterval(reconcile, FUNDED_RECONCILE_MS)
        : null;
    return () => {
      if (timer !== null) window.clearInterval(timer);
      window.removeEventListener("focus", reconcileWhenVisible);
      document.removeEventListener("visibilitychange", reconcileWhenVisible);
    };
  }, [batch?.id, batch?.activation.status, batch?.batchManifestRegisteredAt]);

  useEffect(() => {
    if (!showKaswareHelp) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowKaswareHelp(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showKaswareHelp]);

  useEffect(() => {
    if (!showCreatedDialog) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowCreatedDialog(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showCreatedDialog]);

  const summary = useMemo(() => {
    if (!batch) return null;
    const funded = batch.links.filter((link) => link.status === "funded").length;
    const closed = batch.links.filter((link) => isBatchLinkClosed(link.status)).length;
    const claimed = batch.links.filter((link) => link.status === "claimed").length;
    return {
      claimed,
      closed,
      funded,
      waiting: batch.links.length - funded - closed,
      activation: batch.activation.status,
    };
  }, [batch]);

  // Non-custodial flow steps (mirrors the main claimable lab for consistency)
  const flowSteps = useMemo(() => {
    const status = batch?.activation.status;
    const hasBatch = !!batch;

    return [
      {
        label: "Create",
        state: hasBatch ? "done" : "active",
        text: "Set names, amount, and expiry.",
      },
      {
        label: "Fund",
        state:
          status === "awaiting_funding"
            ? "active"
            : status === "funded" || status === "activated" || status === "refunded"
              ? "done"
              : "locked",
        text: "Save recovery, then fund the exact total once.",
      },
      {
        label: "Create outputs",
        state:
          status === "funded"
            ? "active"
            : status === "activated"
              ? "done"
              : status === "refunded"
                ? "done"
                : "locked",
        text: "Create the individual on-chain rewards.",
      },
      {
        label: "Share",
        state: status === "activated" ? "active" : status === "refunded" ? "done" : "locked",
        text: "Copy or export each claim link.",
      },
    ] as const;
  }, [batch]);

  // Live batch expiry estimate (same DAA logic as single claimables)
  const batchExpiry = useMemo(() => {
    if (!batch?.links?.[0]?.refundLockTime) return null;
    return estimateClaimableExpiry({
      currentDaaScore,
      daaLoadedAtMs: currentDaaLoadedAtMs,
      nowMs: timerNowMs,
      refundLockTime: batch.links[0].refundLockTime,
    });
  }, [batch, currentDaaScore, currentDaaLoadedAtMs, timerNowMs]);

  const batchFundingAmountKas = useMemo(
    () => (batch ? formatSompiForToccataLab(BigInt(batch.activation.fundingAmountSompi)) : ""),
    [batch],
  );
  const batchFundingWalletUri = useMemo(
    () =>
      batch
        ? buildWalletLaunchUri({
            amountKas: batchFundingAmountKas,
            recipientAddress: batch.activation.fundingAddress,
          })
        : "",
    [batch, batchFundingAmountKas],
  );
  const firstDistributableLink =
    batch?.activation.status === "activated"
      ? batch.links.find(
          (link) =>
            link.status === "funded" &&
            Boolean(link.fundingMatch) &&
            !link.hidden &&
            !link.deletedAt,
        )
      : undefined;
  const firstDistributableClaimUrl =
    batch && firstDistributableLink && typeof window !== "undefined"
      ? buildClaimUrl(firstDistributableLink, batch)
      : "";
  const batchCreationPreview = useMemo(() => {
    const linkCount = Number.parseInt(count, 10);
    if (!Number.isInteger(linkCount) || linkCount < 2 || linkCount > MAX_BATCH_SIZE) return null;
    try {
      const plan = planToccataCanaryClaimFromNetKas({ feeKas, netAmountKas: amountKas });
      return {
        exactTotalKas: formatSompiForToccataLab(
          plan.utxoSompi * BigInt(linkCount) + BATCH_ACTIVATION_FEE_SOMPI,
        ),
        fundingPerLinkKas: plan.utxoKas,
        netClaimKas: plan.netOutputKas,
      };
    } catch {
      return null;
    }
  }, [amountKas, count, feeKas]);

  async function persist(next: BatchRecord | null) {
    if (!next) {
      removeEncryptedLocalJson(STORAGE_KEY);
      batchRef.current = null;
      setBatch(null);
      return;
    }
    const stamped = { ...next, updatedAtMs: Date.now() };
    await writeEncryptedLocalJson(STORAGE_KEY, stamped);
    batchRef.current = stamped;
    setBatch(stamped);
  }

  function changeLinkCount(nextCount: string) {
    const parsedCount = Number.parseInt(nextCount, 10);
    setCount(nextCount);
    if (!Number.isInteger(parsedCount) || parsedCount < 2 || parsedCount > MAX_BATCH_SIZE) return;
    setLinkTitles((current) => resizeLinkTitles(current, parsedCount));
  }

  function changeLinkTitle(index: number, nextTitle: string) {
    setLinkTitles((current) =>
      current.map((title, currentIndex) => (currentIndex === index ? nextTitle : title)),
    );
  }

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!enabled) {
      setError("Claim Drops are disabled on this deployment.");
      return;
    }
    if (!capabilities.ready) {
      setError("The Toccata SDK capability gate is not ready.");
      return;
    }
    if (batch) {
      setError(EXISTING_BATCH_ERROR);
      return;
    }
    if (!readCreatorAuthHeaders()) {
      setError("Sign in as a creator first so every child link can be registered safely.");
      return;
    }

    const linkCount = Number.parseInt(count, 10);
    if (!Number.isInteger(linkCount) || linkCount < 2 || linkCount > MAX_BATCH_SIZE) {
      setError(`Choose between 2 and ${MAX_BATCH_SIZE} links for this Claim Drop.`);
      return;
    }

    const normalizedLinkTitles = linkTitles.slice(0, linkCount).map((value, index) => {
      const normalized = value.trim().slice(0, 80);
      return normalized || `Claim link #${index + 1}`;
    });

    let securedLocally = false;
    setGenerating(true);
    try {
      const daaResponse = await fetch("/api/toccata-lab/dag-info");
      const daaBody = (await daaResponse.json()) as {
        virtualDaaScore?: string;
        error?: { message: string };
      };
      if (!daaResponse.ok || !daaBody.virtualDaaScore) {
        throw new Error(daaBody.error?.message ?? "Could not read the current Kaspa DAA score.");
      }

      const spendPlan = planToccataCanaryClaimFromNetKas({
        feeKas,
        netAmountKas: amountKas,
      });
      const expiryPlan = planToccataCanaryExpiry({
        currentDaaScore: daaBody.virtualDaaScore,
        durationValue: expiryValue,
        unit: expiryUnit,
      });
      if (!spendPlan.meetsMinimumOutput) {
        throw new Error(`Net claim output must stay above ${spendPlan.minimumOutputKas} KAS.`);
      }

      const keyPairs = Array.from({ length: linkCount }, () => ({
        claim: createToccataLabKeyPair(),
        refund: createToccataLabKeyPair(),
      }));
      const scriptResponse = await fetch("/api/toccata-lab/batch-scripts", {
        body: JSON.stringify({
          links: keyPairs.map(({ claim, refund }) => ({
            linkPublicKey: claim.xOnlyPublicKey,
            refundPublicKey: refund.xOnlyPublicKey,
          })),
          refundLockTime: expiryPlan.refundLockTime.toString(),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const scriptBody = (await scriptResponse.json()) as
        | ScriptResponse
        | { error?: { message?: string } };
      if (
        !scriptResponse.ok ||
        !("scripts" in scriptBody) ||
        scriptBody.scripts.length !== linkCount
      ) {
        throw new Error(
          "error" in scriptBody
            ? (scriptBody.error?.message ?? "Could not derive batch funding addresses.")
            : "Could not derive batch funding addresses.",
        );
      }

      const activation = createToccataLabKeyPair();
      const batchRefund = createToccataLabKeyPair();
      const allocatorResponse = await fetch("/api/toccata-lab/batch-allocator-script", {
        body: JSON.stringify({
          activationPublicKey: activation.xOnlyPublicKey,
          outputs: scriptBody.scripts.map((script) => ({
            amountSompi: spendPlan.utxoSompi.toString(),
            scriptPublicKeyHex: serializeScriptPublicKey(script.scriptPublicKey),
          })),
          refundLockTime: expiryPlan.refundLockTime.toString(),
          refundPublicKey: batchRefund.xOnlyPublicKey,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const allocatorBody = (await allocatorResponse.json()) as {
        allocator?: { fundingAddress: string; redeemScriptHex: string };
        error?: { message?: string };
      };
      if (!allocatorResponse.ok || !allocatorBody.allocator) {
        throw new Error(
          allocatorBody.error?.message ?? "Could not create the batch funding contract.",
        );
      }

      const createdAt = new Date();
      const batchId = `batch-${createdAt.getTime().toString(36)}-${randomToken().slice(0, 8)}`;
      const normalizedTitle = title.trim().slice(0, 80) || "Community claim drop";
      const normalizedDescription =
        description.trim().slice(0, 180) || "Claim this Kaspa reward to your own wallet.";
      const next: BatchRecord = {
        activation: {
          activationCode: activation.privateKey,
          activationFeeSompi: BATCH_ACTIVATION_FEE_SOMPI.toString(),
          activationPublicKey: activation.xOnlyPublicKey,
          fundingAddress: allocatorBody.allocator.fundingAddress,
          fundingAmountSompi: (
            spendPlan.utxoSompi * BigInt(linkCount) +
            BATCH_ACTIVATION_FEE_SOMPI
          ).toString(),
          fundingMatch: null,
          redeemScriptHex: allocatorBody.allocator.redeemScriptHex,
          refundCode: batchRefund.privateKey,
          refundPublicKey: batchRefund.xOnlyPublicKey,
          status: "awaiting_funding",
        },
        createdAt: createdAt.toISOString(),
        createdAtMs: createdAt.getTime(),
        id: batchId,
        links: scriptBody.scripts.map((script, index) => ({
          amountKas: spendPlan.utxoKas,
          amountSompi: spendPlan.utxoSompi.toString(),
          claimCode: keyPairs[index]!.claim.privateKey,
          claimPublicKey: keyPairs[index]!.claim.xOnlyPublicKey,
          description: normalizedDescription,
          feeKas: spendPlan.feeKas,
          feeSompi: spendPlan.feeSompi.toString(),
          fundingAddress: script.fundingAddress,
          fundingMatch: null,
          id: `${batchId}-${String(index + 1).padStart(2, "0")}`,
          netClaimKas: spendPlan.netOutputKas,
          redeemScriptHex: script.redeemScriptHex,
          refundCode: keyPairs[index]!.refund.privateKey,
          refundLockTime: expiryPlan.refundLockTime.toString(),
          refundPublicKey: keyPairs[index]!.refund.xOnlyPublicKey,
          scriptPublicKeyHex: serializeScriptPublicKey(script.scriptPublicKey),
          status: "awaiting_activation",
          title: normalizedLinkTitles[index]!,
        })),
        title: normalizedTitle,
        validFor: expiryPlan.durationLabel,
        version: 2,
      };
      await persist(next);
      securedLocally = true;
      await registerAllBatchLinks(next);
      const registeredAt = new Date().toISOString();
      const registered = {
        ...next,
        batchManifestRegisteredAt: registeredAt,
        registrationCompleteAt: registeredAt,
      };
      await persist(registered);
      setShowKaswareHelp(false);
      setShowFundingQr(false);
      setNotice(
        `Batch created locally. All private codes (activation + per-link claim/refund) stay in your browser. Fund the single allocator address, then create the child outputs.`,
      );
    } catch (createError) {
      const message = friendlyBatchError(createError, "Could not create the batch.");
      setError(
        securedLocally
          ? `${message} The complete Claim Drop is encrypted locally; use “Finish link registration” instead of creating it again.`
          : message,
      );
    } finally {
      setGenerating(false);
    }
  }

  async function checkFunding(options: { quiet?: boolean } = {}) {
    const currentBatch = batchRef.current;
    if (!currentBatch || fundingCheckInFlight.current || batchActionInFlight.current) return;
    fundingCheckInFlight.current = true;

    if (!options.quiet) {
      setError("");
      setChecking(true);
    }
    try {
      const response = await fetch("/api/toccata-lab/funding-status", {
        body: JSON.stringify({
          amountSompi: currentBatch.activation.fundingAmountSompi,
          fundingAddress: currentBatch.activation.fundingAddress,
          notBefore: currentBatch.createdAtMs,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as {
        funded?: boolean;
        match?: FundingMatch | null;
        outputStatus?: "funded_unspent" | "spent" | "unfunded";
        unmatchedOutputs?: UnmatchedFundingOutput[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "Could not check batch funding.");
      setUnmatchedFundingOutputs(body.unmatchedOutputs ?? []);

      let resolvedMessage = "No exact batch funding output found yet.";
      if (body.funded && body.match) {
        if (body.outputStatus === "spent") {
          const reconciled = await reconcileRegisteredBatch(currentBatch, {
            reportError: !options.quiet,
          });
          if (reconciled?.activation.status === "activated") {
            resolvedMessage = "Batch activation confirmed. Individual claim links are ready.";
          } else if (reconciled?.activation.status === "refunded") {
            resolvedMessage = "The unactivated batch refund is confirmed.";
          } else {
            const latest = batchRef.current?.id === currentBatch.id ? batchRef.current : null;
            if (
              !latest ||
              (latest.activation.status !== "awaiting_funding" &&
                latest.activation.status !== "funded")
            ) {
              resolvedMessage = "The latest batch status was restored.";
            } else {
              const next = {
                ...latest,
                activation: {
                  ...latest.activation,
                  fundingMatch: body.match,
                  status: "funded",
                },
              } as BatchRecord;
              if (
                latest.activation.status !== "funded" ||
                !sameBatchFundingMatch(latest.activation.fundingMatch, body.match)
              ) {
                await persist(next);
              }
              resolvedMessage =
                "The batch funding output was spent, but its outcome is still being reconciled. Retry the same activation or refresh shortly.";
            }
          }
        } else {
          const latest = batchRef.current?.id === currentBatch.id ? batchRef.current : null;
          if (
            !latest ||
            (latest.activation.status !== "awaiting_funding" &&
              latest.activation.status !== "funded")
          ) {
            resolvedMessage = "The latest batch status was restored.";
          } else {
            const next = {
              ...latest,
              activation: {
                ...latest.activation,
                fundingMatch: body.match,
                status: "funded",
              },
            } as BatchRecord;
            if (
              latest.activation.status !== "funded" ||
              !sameBatchFundingMatch(latest.activation.fundingMatch, body.match)
            ) {
              await persist(next);
            }
            resolvedMessage =
              "Funding detected. Activate the batch to create the individual claim outputs.";
          }
        }
        setShowKaswareHelp(false);
      } else if ((body.unmatchedOutputs?.length ?? 0) > 0) {
        resolvedMessage =
          "A payment reached the allocator address, but it does not match the exact batch total. Review it below.";
      }
      if (!options.quiet) {
        setNotice(resolvedMessage);
      }
    } catch (checkError) {
      if (!options.quiet) {
        setError(
          checkError instanceof Error ? checkError.message : "Could not check batch funding.",
        );
      }
    } finally {
      fundingCheckInFlight.current = false;
      if (!options.quiet) {
        setChecking(false);
      }
    }
  }

  async function readRegisteredBatchState(batchKey: string): Promise<RegisteredBatchState> {
    const headers = readCreatorAuthHeaders();
    if (!headers) throw new Error("Sign in again to reconcile this batch.");
    const response = await fetch(
      `/api/creator/claimable-batches?${new URLSearchParams({ batchKey }).toString()}`,
      { headers },
    );
    const body = (await response.json()) as {
      claimableBatch?: RegisteredBatchState;
      error?: { message?: string };
    };
    if (!response.ok || !body.claimableBatch) {
      throw new Error(body.error?.message ?? "Could not reconcile the registered batch.");
    }
    return body.claimableBatch;
  }

  function reconcileRegisteredBatch(
    base: BatchRecord | undefined = batchRef.current ?? undefined,
    options: { reportError?: boolean; syncMyLinks?: boolean } = {},
  ): Promise<BatchRecord | null> {
    if (!base?.batchManifestRegisteredAt) return Promise.resolve(base ?? null);
    if (batchReconcileInFlight.current?.batchId === base.id) {
      return batchReconcileInFlight.current.promise;
    }

    const requestId = Symbol(base.id);
    const task = (async () => {
      try {
        const serverState = await readRegisteredBatchState(base.id);
        const latest = batchRef.current?.id === base.id ? batchRef.current : null;
        if (!latest) return null;
        const next = reconcileBatchWithServer(latest, serverState);
        if (next !== latest) await persist(next);
        if (next.activation.status === "activated" && (next !== latest || options.syncMyLinks)) {
          await saveBatchLinksToMyLinks(next);
        }
        return next;
      } catch (reconcileError) {
        if (options.reportError) {
          setError(
            reconcileError instanceof Error
              ? reconcileError.message
              : "Could not reconcile the registered batch.",
          );
        }
        return null;
      } finally {
        if (batchReconcileInFlight.current?.requestId === requestId) {
          batchReconcileInFlight.current = null;
        }
      }
    })();
    batchReconcileInFlight.current = { batchId: base.id, promise: task, requestId };
    return task;
  }

  async function completeBatchRegistration() {
    if (!batch || batch.batchManifestRegisteredAt) return;
    setRegistering(true);
    setError("");
    try {
      await registerAllBatchLinks(batch);
      const registeredAt = new Date().toISOString();
      await persist({
        ...batch,
        batchManifestRegisteredAt: registeredAt,
        registrationCompleteAt: registeredAt,
      });
      setNotice("All public child metadata is registered. The batch is ready to fund.");
    } catch (registrationError) {
      setError(
        friendlyBatchError(
          registrationError,
          "Could not finish registering the public child metadata.",
        ),
      );
    } finally {
      setRegistering(false);
    }
  }

  function openBatchFundingWallet() {
    if (!batchFundingWalletUri || !batch?.batchManifestRegisteredAt || !batch.recoveryExportedAt)
      return;
    setError("");
    setShowKaswareHelp(false);
    setNotice(
      `Opening Kaspium with ${batchFundingAmountKas} KAS and the one-time batch address. Return here after sending; funding will be checked automatically.`,
    );
    window.setTimeout(() => void checkFunding({ quiet: true }), 2_500);
    window.setTimeout(() => void checkFunding({ quiet: true }), 7_000);
    window.location.assign(batchFundingWalletUri);
  }

  async function fundBatchWithKasware() {
    if (
      !batch?.batchManifestRegisteredAt ||
      !batch.recoveryExportedAt ||
      batch.activation.status !== "awaiting_funding"
    )
      return;

    setError("");
    setNotice("");
    setFundingWithKasware(true);
    try {
      const provider = getKaswareProvider();
      if (!provider) {
        setError("");
        setShowFundingQr(true);
        setShowKaswareHelp(true);
        setNotice("");
        return;
      }

      const network = await readKaswareNetwork(provider);
      if (network !== "mainnet") {
        throw new WalletAdapterError(
          network === "unknown"
            ? "Could not verify KasWare's network. Switch KasWare to mainnet and retry."
            : `Switch KasWare to mainnet before funding. It is currently on ${network}.`,
          { code: "KASWARE_WRONG_NETWORK" },
        );
      }

      const fundingAmountSompi = BigInt(batch.activation.fundingAmountSompi);
      try {
        const balance = await readKaswareBalance(provider);
        if (balance) {
          const confirmed = BigInt(balance.confirmed);
          if (confirmed < fundingAmountSompi) {
            throw new WalletAdapterError(
              "KasWare's confirmed balance is lower than the exact batch funding total.",
              { code: "KASWARE_INSUFFICIENT_BALANCE" },
            );
          }
          if (confirmed - fundingAmountSompi < FUNDING_SAFE_CHANGE_SOMPI) {
            setNotice(
              "Your remaining KasWare change may be too small for Kaspa's storage-mass rule. If funding is rejected, use a wallet with a larger consolidated balance.",
            );
          }
        }
      } catch (balanceError) {
        if (balanceError instanceof WalletAdapterError) throw balanceError;
      }

      let result: Awaited<ReturnType<typeof sendKaspaPayment>> | null = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          result = await sendKaspaPayment(provider, {
            amountSompi: fundingAmountSompi,
            toAddress: batch.activation.fundingAddress,
          });
          break;
        } catch (attemptError) {
          const message =
            attemptError instanceof Error ? attemptError.message : String(attemptError);
          const transient = /not connected|websocket|rpc server/i.test(message);
          if (attempt < 3 && transient) {
            setNotice("KasWare is connecting to the network — retrying…");
            await new Promise((resolve) => window.setTimeout(resolve, 1_200));
            continue;
          }
          throw attemptError;
        }
      }
      if (!result) {
        throw new WalletAdapterError("KasWare did not complete the batch funding transaction.", {
          code: "KASWARE_FUNDING_FAILED",
        });
      }

      setShowKaswareHelp(false);
      setNotice(
        result.txId
          ? `KasWare sent the batch funding transaction ${compactTransactionId(result.txId)}. Checking the one-time address now.`
          : "KasWare completed the wallet request without returning a transaction id. Checking the one-time address for the exact funding output now.",
      );
      window.setTimeout(() => void checkFunding({ quiet: true }), 1_500);
      window.setTimeout(() => void checkFunding({ quiet: true }), 5_000);
    } catch (fundingError) {
      setError(
        fundingError instanceof Error
          ? fundingError.message
          : "KasWare did not complete the batch funding transaction.",
      );
    } finally {
      setFundingWithKasware(false);
    }
  }

  async function copyBatchFundingAddress() {
    if (!batch?.batchManifestRegisteredAt || !batch.recoveryExportedAt) return;
    try {
      await navigator.clipboard.writeText(batch.activation.fundingAddress);
      setError("");
      setNotice("Batch funding address copied.");
    } catch {
      setError("Could not copy the batch funding address.");
    }
  }

  async function copyText(value: string, successMessage: string) {
    setError("");
    setNotice("");
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch {
      setError("Clipboard copy failed.");
    }
  }

  async function activateBatch() {
    const currentBatch = batchRef.current;
    if (
      !currentBatch?.activation.fundingMatch ||
      currentBatch.activation.status !== "funded" ||
      batchActionInFlight.current
    )
      return;
    if (batchExpiry?.expired !== false) {
      setError(
        batchExpiry?.expired
          ? "This batch expired before activation. Refund the unactivated batch instead."
          : "Wait until the current Kaspa DAA score is available before activating this batch.",
      );
      return;
    }
    const creatorHeaders = readCreatorAuthHeaders();
    if (!creatorHeaders) {
      setError("Sign in again before activating this batch.");
      return;
    }
    setChecking(true);
    batchActionInFlight.current = "activate";
    setError("");
    setActivationConfirmed(false);
    try {
      const spend = await buildBatchActivationSpendInBrowser({
        activationPrivateKey: currentBatch.activation.activationCode,
        expectedFundingAddress: currentBatch.activation.fundingAddress,
        feeSompi: currentBatch.activation.activationFeeSompi,
        fundingAmountSompi: currentBatch.activation.fundingAmountSompi,
        fundingOutputIndex: currentBatch.activation.fundingMatch.outputIndex,
        fundingTransactionId: currentBatch.activation.fundingMatch.transactionId,
        outputs: currentBatch.links.map((link) => ({
          amountSompi: link.amountSompi,
          redeemScriptHex: link.redeemScriptHex,
        })),
        redeemScriptHex: currentBatch.activation.redeemScriptHex,
      });
      const response = await fetch("/api/toccata-lab/batch-activate", {
        body: JSON.stringify({
          batchKey: currentBatch.id,
          expectedTransactionId: spend.transactionId,
          transactionSafeJson: spend.transactionSafeJson,
        }),
        headers: creatorHeaders,
        method: "POST",
      });
      const body = (await response.json()) as {
        broadcast?: { transactionId: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.broadcast)
        throw new Error(body.error?.message ?? "Could not activate the batch.");
      const latest = batchRef.current?.id === currentBatch.id ? batchRef.current : currentBatch;
      const next = {
        ...latest,
        activation: { ...latest.activation, status: "activated" as const },
        links: latest.links.map((link, index) => ({
          ...link,
          fundingMatch: {
            amountSompi: link.amountSompi,
            blockTime: null,
            outputIndex: index,
            transactionId: body.broadcast!.transactionId,
          },
          status: "funded" as const,
        })),
      };
      await persist(next);
      await saveBatchLinksToMyLinks(next).catch(() => {
        // My Links repairs this encrypted browser-only index from the batch vault on next open.
      });
      await reconcileRegisteredBatch(next, { syncMyLinks: true });
      setShowKaswareHelp(false);
      setShowCreatedDialog(true);
      setNotice(
        `Claim outputs created. ${next.links.length} individual claim links are now ready. All codes stayed in your browser.`,
      );
    } catch (activationError) {
      setError(friendlyBatchError(activationError, "Could not activate the batch."));
    } finally {
      batchActionInFlight.current = null;
      setChecking(false);
    }
  }

  // clear transient kasware help when activating (funding is already confirmed)

  async function refundUnactivatedBatch() {
    const currentBatch = batchRef.current;
    if (
      !currentBatch?.activation.fundingMatch ||
      currentBatch.activation.status !== "funded" ||
      batchActionInFlight.current
    )
      return;
    const creatorHeaders = readCreatorAuthHeaders();
    if (!creatorHeaders) {
      setError("Sign in again before refunding this batch.");
      return;
    }
    setChecking(true);
    batchActionInFlight.current = "refund";
    setError("");
    try {
      const refundLockTime = currentBatch.links[0]?.refundLockTime;
      if (!refundLockTime) throw new Error("Batch refund lock time is unavailable.");
      const spend = await buildClaimableSpendInBrowser({
        destinationAddress: refundAddress,
        expectedFundingAddress: currentBatch.activation.fundingAddress,
        feeSompi: currentBatch.activation.activationFeeSompi,
        fundingAmountSompi: currentBatch.activation.fundingAmountSompi,
        fundingOutputIndex: currentBatch.activation.fundingMatch.outputIndex,
        fundingTransactionId: currentBatch.activation.fundingMatch.transactionId,
        lockTime: refundLockTime,
        mode: "refund",
        privateKey: currentBatch.activation.refundCode,
        redeemScriptHex: currentBatch.activation.redeemScriptHex,
      });
      const response = await fetch("/api/toccata-lab/batch-refund", {
        body: JSON.stringify({
          batchKey: currentBatch.id,
          expectedTransactionId: spend.transactionId,
          refundLockTime,
          transactionSafeJson: spend.transactionSafeJson,
        }),
        headers: creatorHeaders,
        method: "POST",
      });
      const body = (await response.json()) as {
        broadcast?: { transactionId: string };
        error?: { message?: string };
      };
      if (!response.ok || !body.broadcast)
        throw new Error(body.error?.message ?? "Could not refund the batch.");
      const latest = batchRef.current?.id === currentBatch.id ? batchRef.current : currentBatch;
      const next = {
        ...latest,
        activation: { ...latest.activation, status: "refunded" as const },
      };
      await persist(next);
      await reconcileRegisteredBatch(next);
      setShowKaswareHelp(false);
      setNotice("The unactivated batch refund was accepted. No claim URLs were distributed.");
    } catch (refundError) {
      setError(friendlyBatchError(refundError, "Could not refund the batch."));
    } finally {
      batchActionInFlight.current = null;
      setChecking(false);
    }
  }

  async function recoverUnexpectedBatchFunding(output: UnmatchedFundingOutput) {
    if (!batch || batchExpiry?.expired !== true) return;
    const creatorHeaders = readCreatorAuthHeaders();
    if (!creatorHeaders) {
      setError("Sign in again before recovering this payment.");
      return;
    }
    if (!refundConfirmed || !refundAddress.trim()) {
      setError("Enter and confirm your Kaspa refund address first.");
      return;
    }

    const outputId = `${output.transactionId}:${output.outputIndex}`;
    setRecoveringOutputId(outputId);
    setRecoveryTxId("");
    setError("");
    try {
      const refundLockTime = batch.links[0]?.refundLockTime;
      if (!refundLockTime) throw new Error("Batch refund lock time is unavailable.");
      const spend = await buildClaimableSpendInBrowser({
        destinationAddress: refundAddress,
        expectedFundingAddress: batch.activation.fundingAddress,
        feeSompi: batch.activation.activationFeeSompi,
        fundingAmountSompi: output.amountSompi,
        fundingOutputIndex: output.outputIndex,
        fundingTransactionId: output.transactionId,
        lockTime: refundLockTime,
        mode: "refund",
        privateKey: batch.activation.refundCode,
        redeemScriptHex: batch.activation.redeemScriptHex,
      });
      const response = await fetch("/api/toccata-lab/batch-refund", {
        body: JSON.stringify({
          batchKey: batch.id,
          expectedTransactionId: spend.transactionId,
          refundLockTime,
          transactionSafeJson: spend.transactionSafeJson,
        }),
        headers: creatorHeaders,
        method: "POST",
      });
      const body = (await response.json()) as {
        broadcast?: { submittedTransactionId?: string; transactionId: string };
        mismatchRecovery?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !body.broadcast || body.mismatchRecovery !== true) {
        throw new Error(body.error?.message ?? "Could not recover the unexpected batch payment.");
      }
      setUnmatchedFundingOutputs((current) =>
        current.filter(
          (candidate) =>
            candidate.transactionId !== output.transactionId ||
            candidate.outputIndex !== output.outputIndex,
        ),
      );
      setRecoveryTxId(body.broadcast.submittedTransactionId ?? body.broadcast.transactionId);
      setNotice(
        "Unexpected allocator payment recovered to your address. The batch itself was not changed.",
      );
    } catch (recoveryError) {
      setError(friendlyBatchError(recoveryError, "Could not recover the unexpected payment."));
    } finally {
      setRecoveringOutputId("");
    }
  }

  function downloadFundingPlan() {
    if (!batch) return;
    downloadCsv(
      "kaspa-links-batch-funding.csv",
      ["batch_name", "funding_address", "exact_total_kas", "activation_fee_kas", "status"],
      [
        [
          batch.title,
          batch.activation.fundingAddress,
          formatSompiForToccataLab(BigInt(batch.activation.fundingAmountSompi)),
          formatSompiForToccataLab(BigInt(batch.activation.activationFeeSompi)),
          batch.activation.status,
        ],
      ],
    );
  }

  function downloadClaimLinks() {
    if (!batch) return;
    const funded = batch.links.filter((link) => link.status === "funded" && link.fundingMatch);
    downloadCsv(
      "kaspa-links-batch-claim-links.csv",
      ["number", "title", "claim_url", "amount_kas", "valid_for"],
      funded.map((link, index) => [
        index + 1,
        link.title,
        buildClaimUrl(link, batch),
        link.netClaimKas,
        batch.validFor,
      ]),
    );
  }

  async function downloadRecoveryFile() {
    if (!batch) return;
    const exportedAt = new Date().toISOString();
    const exportedBatch = { ...batch, recoveryExportedAt: exportedAt };
    downloadJson(
      `kaspa-links-${safeFilename(batch.title)}-${safeFilename(shortBatchReference(batch.id))}-private-recovery.json`,
      createBatchRecoveryBundle(exportedBatch, exportedAt),
    );
    try {
      await persist(exportedBatch);
      setNotice("Private recovery bundle downloaded. Keep it offline and never share it.");
    } catch {
      setError("Recovery bundle downloaded, but its export status could not be saved locally.");
    }
  }

  async function importRecoveryFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (batch) {
      input.value = "";
      setError("Clear the current local batch before importing another recovery bundle.");
      return;
    }
    setError("");
    try {
      if (file.size > 1_000_000) throw new Error("Recovery file is unexpectedly large.");
      const bundle = parseBatchRecoveryBundle(await readTextFile(file));
      assertBatchMatchesRecoveryTarget(bundle.batch, recoveryTarget);
      await registerAllBatchLinks(bundle.batch);
      const registeredAt = new Date().toISOString();
      const imported = {
        ...bundle.batch,
        batchManifestRegisteredAt: registeredAt,
        registrationCompleteAt: registeredAt,
      };
      await persist(imported);
      await reconcileRegisteredBatch(imported, { reportError: true, syncMyLinks: true });
      setNotice(
        `Recovered “${bundle.batch.title}” locally. Its public contract was revalidated; private codes were not uploaded.`,
      );
    } catch (importError) {
      setError(friendlyBatchError(importError, "Could not import the recovery bundle."));
    } finally {
      input.value = "";
    }
  }

  async function showClaimQr(link: BatchLink) {
    if (!batch) return;
    const claimUrl = buildClaimUrl(link, batch);
    if (!claimUrl) return;
    setClaimQrLoadingId(link.id);
    setError("");
    try {
      const QRCode = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(claimUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 720,
      });
      setClaimQr({ dataUrl, linkId: link.id, title: link.title });
    } catch (qrError) {
      setError(friendlyBatchError(qrError, "Could not create the claim QR code."));
    } finally {
      setClaimQrLoadingId("");
    }
  }

  async function toggleDistribution(linkId: string) {
    if (!batch) return;
    try {
      await persist({
        ...batch,
        links: batch.links.map((link) =>
          link.id === linkId ? { ...link, hidden: !link.hidden } : link,
        ),
      });
      setNotice(
        "Distribution preference updated locally. This does not revoke or change the on-chain output.",
      );
    } catch (persistError) {
      setError(friendlyBatchError(persistError, "Could not update the local batch."));
    }
  }

  async function clearLocalBatch() {
    if (!batch) return;
    setError("");
    if (!batch.recoveryExportedAt && batch.batchManifestRegisteredAt) {
      try {
        const response = await fetch("/api/toccata-lab/funding-status", {
          body: JSON.stringify({
            amountSompi: batch.activation.fundingAmountSompi,
            fundingAddress: batch.activation.fundingAddress,
            notBefore: batch.createdAtMs,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = (await response.json()) as {
          funded?: boolean;
          error?: { message?: string };
        };
        if (!response.ok) throw new Error(body.error?.message ?? "Could not verify batch funding.");
        if (body.funded) {
          throw new Error(
            "Funding exists for this batch. Download the private recovery bundle before clearing it.",
          );
        }
      } catch (clearError) {
        setShowClearDialog(false);
        setError(
          clearError instanceof Error
            ? clearError.message
            : "Could not safely verify this batch before clearing it.",
        );
        return;
      }
    }
    try {
      await persist(null);
      setShowClearDialog(false);
      setNotice("Local batch data cleared from this browser.");
    } catch (clearError) {
      setShowClearDialog(false);
      setError(friendlyBatchError(clearError, "Could not clear the local batch."));
    }
  }

  function openIndividualRefund(link: BatchLink) {
    const activeBatch = batch;
    if (!activeBatch) return;
    const refundUrl = buildRefundUrl(link, activeBatch);
    if (!refundUrl) return;
    window.open(refundUrl, "_blank", "noopener,noreferrer");
  }

  function renderClearDialog() {
    if (!showClearDialog || !batch) return null;
    return (
      <div
        className="batch-wallet-modal-backdrop"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) setShowClearDialog(false);
        }}
        role="presentation"
      >
        <section
          aria-labelledby="batch-clear-title"
          aria-modal="true"
          className="batch-wallet-modal"
          role="dialog"
        >
          <button
            aria-label="Cancel clearing the batch"
            className="batch-wallet-modal-close"
            onClick={() => setShowClearDialog(false)}
            type="button"
          >
            ×
          </button>
          <span className="label">Clear local recovery</span>
          <h2 id="batch-clear-title">Are you sure?</h2>
          <p>
            This removes this batch and its private recovery data from this browser. It does not
            undo funding or change any on-chain transaction.
          </p>
          {!batch.recoveryExportedAt &&
          (batch.activation.status === "funded" || batch.activation.status === "activated") ? (
            <p className="notice notice-critical">
              This batch is funded or active. Download the recovery bundle first; clearing is
              blocked while browser-held recovery is not secured.
            </p>
          ) : null}
          <div className="batch-wallet-modal-actions">
            <button className="btn" onClick={() => setShowClearDialog(false)} type="button">
              Keep recovery
            </button>
            <button className="btn btn-danger" onClick={() => void clearLocalBatch()} type="button">
              Yes, clear recovery
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (mode === "recovery") {
    const visibleLinks = batch?.links.filter((link) => !link.deletedAt) ?? [];
    const visibleLinkCount = visibleLinks.length;
    const refundedCount = visibleLinks.filter((link) => link.status === "refunded").length;
    const remainingRefundCount = visibleLinks.filter(
      (link) => !isBatchLinkTerminal(link.status),
    ).length;
    const fullyRefunded = visibleLinkCount > 0 && refundedCount === visibleLinkCount;
    const partiallyRefunded = refundedCount > 0 && !fullyRefunded;
    const recoveryStatus =
      batch?.activation.status === "refunded" || fullyRefunded
        ? "Refunded"
        : partiallyRefunded
          ? "Partially refunded"
          : batch?.activation.status.replaceAll("_", " ");
    const recoveryStatusClass =
      batch?.activation.status === "refunded" || fullyRefunded
        ? "refunded"
        : partiallyRefunded
          ? "partially-refunded"
          : batch?.activation.status;
    const recoveryHeadingText =
      batch?.activation.status === "refunded"
        ? "The complete unactivated batch funding was refunded to its destination wallet."
        : fullyRefunded
          ? "Every link in this batch has been refunded to a wallet."
          : partiallyRefunded
            ? `${refundedCount} of ${visibleLinkCount} links refunded. The remaining links keep their individual on-chain status.`
            : batch
              ? batchActivationStatusText(batch.activation.status)
              : "";
    const recoveryTargetMismatch =
      Boolean(batch && recoveryTarget) && batch!.id !== recoveryTarget!.batchKey;

    return (
      <main className="main-wide toccata-lab-page batch-recovery-page">
        <section className="hero toccata-lab-hero batch-recovery-hero">
          <span className="hero-eyebrow">Private recovery</span>
          <h1 className="hero-title">Recover a claim batch.</h1>
          <p className="hero-sub">
            Restore the private recovery bundle saved before funding, then open the refund action
            for the affected link.
          </p>
        </section>

        <section className="batch-recovery-safety" role="note">
          <div>
            <span className="label">Browser-only recovery</span>
            <h2>Your private codes stay on this device.</h2>
          </div>
          <p>
            The file is validated and encrypted locally. Kaspa Links registers and checks only the
            public contract data needed to show current on-chain status.
          </p>
        </section>

        {error ? (
          <div className="notice notice-critical batch-recovery-message" role="alert">
            <strong>Recovery could not be completed.</strong>
            <span>{error}</span>
          </div>
        ) : notice ? (
          <div className="notice batch-recovery-message" role="status">
            <strong>Recovery updated.</strong>
            <span>{notice}</span>
          </div>
        ) : null}

        <input
          accept="application/json,.json"
          hidden
          onChange={(event) => void importRecoveryFile(event)}
          ref={recoveryInputRef}
          type="file"
        />

        {recoveryTargetMismatch && batch && recoveryTarget ? (
          <section className="card batch-recovery-import-card">
            <header>
              <span className="label">Different recovery bundle loaded</span>
              <h2>Use the bundle for {recoveryTarget.title || "the selected claim batch"}</h2>
              <p>
                This browser currently holds recovery data for <strong>{batch.title}</strong> (
                {shortBatchReference(batch.id)}). It cannot refund the requested batch (
                {shortBatchReference(recoveryTarget.batchKey)}).
              </p>
            </header>
            <p className="notice notice-critical">
              No refund action for the loaded batch is shown here, preventing recovery of the wrong
              claim links.
            </p>
            <div className="batch-recovery-actions">
              <button
                className="btn btn-primary"
                onClick={() => setShowClearDialog(true)}
                type="button"
              >
                Use matching recovery bundle
              </button>
              <Link className="btn" href="/my-links">
                Back to My Links
              </Link>
            </div>
          </section>
        ) : !batch ? (
          <section className="card batch-recovery-import-card">
            <header>
              <span className="label">Step 1</span>
              <h2>
                {recoveryTarget?.title
                  ? `Choose the bundle for ${recoveryTarget.title}`
                  : "Choose your private recovery bundle"}
              </h2>
              <p>
                Select the JSON file downloaded when the batch was created. It is read only by this
                browser and is never uploaded as a file.
              </p>
              {recoveryTarget ? (
                <p className="value-mono">
                  Requested batch: {shortBatchReference(recoveryTarget.batchKey)}
                </p>
              ) : null}
            </header>
            <ol className="batch-recovery-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Import</strong>
                  <p>Select the matching private recovery file.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Verify</strong>
                  <p>The browser validates its keys and checks the public on-chain state.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Refund</strong>
                  <p>Open the required refund action and sign it locally.</p>
                </div>
              </li>
            </ol>
            <div className="batch-recovery-actions">
              <button
                className="btn btn-primary"
                disabled={!enabled || !capabilities.ready}
                onClick={() => recoveryInputRef.current?.click()}
                type="button"
              >
                Select recovery bundle
              </button>
              <Link className="btn" href="/my-links">
                Back to My Links
              </Link>
            </div>
            {!enabled || !capabilities.ready ? (
              <p className="notice notice-critical">
                Recovery is temporarily unavailable on this deployment. Your local file remains
                unchanged.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="card batch-recovery-workspace">
            <header className="batch-recovery-heading">
              <div>
                <span className="label">Recovered batch</span>
                <h2>{batch.title}</h2>
                <p className="value-mono">Batch: {shortBatchReference(batch.id)}</p>
                <p>{recoveryHeadingText}</p>
              </div>
              <span className={`status-pill status-${recoveryStatusClass}`}>{recoveryStatus}</span>
            </header>

            <div className="batch-recovery-summary-grid">
              <div>
                <span>Links</span>
                <strong>{batch.links.filter((link) => !link.deletedAt).length}</strong>
              </div>
              <div>
                <span>Claimed</span>
                <strong>{summary?.claimed ?? 0}</strong>
              </div>
              <div>
                <span>Refunded</span>
                <strong>{refundedCount}</strong>
              </div>
              <div>
                <span>Refund availability</span>
                <strong>
                  {batch.activation.status === "refunded" || fullyRefunded
                    ? "Complete"
                    : remainingRefundCount === 0
                      ? "Nothing to refund"
                      : batchExpiry?.expired
                        ? `${remainingRefundCount} ${remainingRefundCount === 1 ? "link" : "links"} ready`
                        : (batchExpiry?.remainingLabel ?? "Checking on-chain time")}
                </strong>
              </div>
            </div>

            {batch.activation.status === "funded" ? (
              <div className="batch-lab-refund batch-recovery-full-refund">
                <span className="label">Unactivated batch refund</span>
                <p className="muted">
                  The batch was funded but its individual outputs were not created. After expiry,
                  refund the complete allocator output to an address you verify.
                </p>
                <label className="label" htmlFor="recovery-batch-refund-address">
                  Refund address
                </label>
                <input
                  id="recovery-batch-refund-address"
                  onChange={(event) => setRefundAddress(event.target.value)}
                  placeholder="kaspa:..."
                  value={refundAddress}
                />
                <label className="batch-lab-confirm">
                  <input
                    checked={refundConfirmed}
                    onChange={(event) => setRefundConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  I verified the destination address. The browser signs locally and the server
                  receives only the signed transaction.
                </label>
                <button
                  className="btn btn-danger"
                  disabled={
                    checking ||
                    refundAddress.trim().length === 0 ||
                    !refundConfirmed ||
                    batchExpiry?.expired !== true
                  }
                  onClick={() => void refundUnactivatedBatch()}
                  type="button"
                >
                  {batchExpiry?.expired
                    ? "Refund complete batch"
                    : `Refund available ${batchExpiry?.remainingLabel ? `in about ${batchExpiry.remainingLabel}` : "after expiry"}`}
                </button>
              </div>
            ) : null}

            {batch.activation.status === "activated" ? (
              <div className="batch-recovery-link-section">
                <div>
                  <span className="label">Individual links</span>
                  <h3>Choose the link to refund</h3>
                </div>
                <ul className="batch-recovery-link-list">
                  {batch.links
                    .filter((link) => !link.deletedAt)
                    .map((link) => {
                      const closed = isBatchLinkTerminal(link.status);
                      const refundReady =
                        link.status === "refundable" || batchExpiry?.expired === true;
                      return (
                        <li
                          className={link.status === "refunded" ? "is-refunded" : undefined}
                          key={link.id}
                        >
                          <div className="batch-recovery-link-copy">
                            <strong>{link.title}</strong>
                            <span>{link.netClaimKas} KAS</span>
                            {link.status === "refunded" ? (
                              <small>
                                Refund completed. This link no longer holds claimable KAS.
                              </small>
                            ) : null}
                          </div>
                          <span className={`batch-lab-link-status is-${link.status}`}>
                            {recoveryLinkStatus(link.status, refundReady)}
                          </span>
                          {!closed && link.fundingMatch ? (
                            <div className="batch-recovery-link-actions">
                              <button
                                className="btn btn-primary"
                                disabled={!refundReady}
                                onClick={() => openIndividualRefund(link)}
                                type="button"
                              >
                                {refundReady ? "Open refund" : "Refund after expiry"}
                              </button>
                              <button
                                className="btn"
                                disabled={!refundReady}
                                onClick={() =>
                                  void copyText(
                                    buildRefundUrl(link, batch),
                                    "Private refund link copied.",
                                  )
                                }
                                type="button"
                              >
                                Copy refund link
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                </ul>
              </div>
            ) : null}

            <div className="batch-recovery-actions">
              <Link className="btn btn-primary" href="/my-links">
                Return to My Links
              </Link>
              <button className="btn" onClick={() => setShowClearDialog(true)} type="button">
                Use another recovery bundle
              </button>
            </div>
          </section>
        )}

        {renderClearDialog()}
      </main>
    );
  }

  if (creatorSignedIn === null) {
    return (
      <main className="main-wide toccata-lab-page">
        <section className="card creator-auth-check">
          <p className="muted">Checking creator session...</p>
        </section>
      </main>
    );
  }

  if (!creatorSignedIn) {
    return (
      <main className="main-wide toccata-lab-page">
        <CreatorSignInGate
          description="A creator profile is required before you configure a Claim Drop, so every child link can be registered and managed safely."
          label="Claim Drop"
          nextPath={`/claim/batch?count=${count}`}
          title="Sign in to create a Claim Drop"
        />
      </main>
    );
  }

  return (
    <main className="main-wide toccata-lab-page">
      <section className="hero toccata-lab-hero">
        <span className="hero-eyebrow">Claim Drop</span>
        <h1 className="hero-title">Create multiple claim links at once.</h1>
        <p className="hero-sub">Create several separately claimable rewards and fund them once.</p>
      </section>

      <section className="batch-lab-warning" role="note">
        <span className="batch-lab-warning-label">Before you fund</span>
        <strong>Every claim link is separate digital cash.</strong>
        <p>Save the recovery bundle before funding. Anyone with a claim link can claim it.</p>
      </section>

      {batch ? (
        <section className="claimable-flow-strip batch-lab-flow-strip" aria-label="Batch flow">
          {flowSteps.map((step, index) => (
            <article className={`claimable-flow-item is-${step.state}`} key={step.label}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <p>{step.text}</p>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {error || notice ? (
        <div
          aria-atomic="true"
          aria-live={error ? "assertive" : "polite"}
          className={`batch-status-toast ${error ? "is-error" : "is-success"}`}
          role={error ? "alert" : "status"}
        >
          <span className="batch-status-toast-mark" aria-hidden="true">
            {error ? "!" : "✓"}
          </span>
          <div>
            <strong>{error ? "Action could not be completed" : "Status updated"}</strong>
            <p>{error || notice}</p>
            {error === EXISTING_BATCH_ERROR && batch ? (
              <button
                className="btn batch-status-toast-action"
                onClick={() => {
                  setError("");
                  setShowClearDialog(true);
                }}
                type="button"
              >
                Clear batch
              </button>
            ) : null}
          </div>
          <button
            aria-label="Dismiss status message"
            onClick={() => {
              setError("");
              setNotice("");
            }}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      {showKaswareHelp ? (
        <div
          className="batch-wallet-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowKaswareHelp(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="batch-wallet-modal-title"
            aria-modal="true"
            className="batch-wallet-modal"
            role="dialog"
          >
            <button
              aria-label="Close wallet options"
              autoFocus
              className="batch-wallet-modal-close"
              onClick={() => setShowKaswareHelp(false)}
              type="button"
            >
              ×
            </button>
            <span className="label">Wallet unavailable</span>
            <h2 id="batch-wallet-modal-title">KasWare was not detected</h2>
            <p>
              Install or unlock the KasWare browser extension, or fund the same one-time address
              with Kaspium. The exact batch total remains unchanged.
            </p>
            <div className="batch-wallet-modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setShowKaswareHelp(false);
                  openBatchFundingWallet();
                }}
                type="button"
              >
                Open in Kaspium
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowKaswareHelp(false);
                  setShowFundingQr(true);
                }}
                type="button"
              >
                Show QR code
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowKaswareHelp(false);
                  void copyBatchFundingAddress();
                }}
                type="button"
              >
                Copy address
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showCreatedDialog && batch?.activation.status === "activated" ? (
        <div
          className="batch-wallet-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowCreatedDialog(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="batch-created-dialog-title"
            aria-modal="true"
            className="batch-wallet-modal batch-created-dialog"
            role="dialog"
          >
            <button
              aria-label="Close completed Claim Drop"
              className="batch-wallet-modal-close"
              onClick={() => setShowCreatedDialog(false)}
              type="button"
            >
              ×
            </button>
            <span aria-hidden="true" className="batch-created-dialog-mark">
              ✓
            </span>
            <span className="label">Claim Drop created</span>
            <h2 id="batch-created-dialog-title">
              Your {batch.links.length} claim {batch.links.length === 1 ? "link is" : "links are"}{" "}
              ready.
            </h2>
            <p>
              Open the first link to see exactly what recipients will see, or review every link
              before sharing.
            </p>
            <div className="batch-wallet-modal-actions batch-created-dialog-actions">
              {firstDistributableClaimUrl ? (
                <button
                  autoFocus
                  className="btn btn-primary"
                  onClick={() => {
                    setShowCreatedDialog(false);
                    window.open(firstDistributableClaimUrl, "_blank", "noopener,noreferrer");
                  }}
                  type="button"
                >
                  Preview first link
                </button>
              ) : null}
              <button
                className="btn"
                onClick={() => {
                  setShowCreatedDialog(false);
                  window.requestAnimationFrame(() =>
                    document
                      .getElementById("batch-created-links")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  );
                }}
                type="button"
              >
                View all links
              </button>
              <button className="btn" onClick={() => setShowCreatedDialog(false)} type="button">
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {claimQr ? (
        <div
          className="batch-wallet-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setClaimQr(null);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="batch-claim-qr-title"
            aria-modal="true"
            className="batch-wallet-modal batch-claim-qr-modal"
            role="dialog"
          >
            <button
              aria-label="Close claim QR code"
              className="batch-wallet-modal-close"
              onClick={() => setClaimQr(null)}
              type="button"
            >
              ×
            </button>
            <span className="label">Private bearer QR</span>
            <h2 id="batch-claim-qr-title">{claimQr.title}</h2>
            <img alt={`Claim QR code for ${claimQr.title}`} src={claimQr.dataUrl} />
            <p className="notice notice-critical">
              Anyone who scans this QR can claim the KAS. It was generated entirely in this browser
              and was not sent to the server.
            </p>
          </section>
        </div>
      ) : null}

      {renderClearDialog()}

      <div className="batch-lab-grid">
        <section className="card batch-lab-panel">
          <header className="batch-lab-panel-heading">
            <span className="batch-lab-step">1</span>
            <div>
              <span className="label">Configure</span>
              <h2 className="form-section-heading">Create a claim drop</h2>
              <p>Set shared values and name each link.</p>
            </div>
          </header>
          <form className="claimable-lab-form" onSubmit={createBatch}>
            <div className="batch-lab-form-section">
              <div>
                <label className="label" htmlFor="batch-title">
                  Drop name
                </label>
                <input
                  id="batch-title"
                  maxLength={80}
                  onChange={(event) => setTitle(event.target.value)}
                  value={title}
                />
              </div>
              <div>
                <label className="label" htmlFor="batch-description">
                  Description
                </label>
                <textarea
                  id="batch-description"
                  maxLength={180}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  value={description}
                />
              </div>
            </div>

            <div className="batch-lab-form-section">
              <span className="batch-lab-section-title">Distribution</span>
              <div className="grid-two batch-lab-distribution-grid">
                <div>
                  <label className="label" htmlFor="batch-count">
                    Number of links
                  </label>
                  <select
                    id="batch-count"
                    onChange={(event) => changeLinkCount(event.target.value)}
                    value={count}
                  >
                    {Array.from({ length: MAX_BATCH_SIZE - 1 }, (_, index) => index + 2).map(
                      (linkCount) => (
                        <option key={linkCount} value={linkCount}>
                          {linkCount} links
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="batch-amount">
                    Recipient gets (KAS) per link
                  </label>
                  <input
                    id="batch-amount"
                    inputMode="decimal"
                    onChange={(event) => setAmountKas(event.target.value.replace(",", "."))}
                    value={amountKas}
                  />
                </div>
              </div>
            </div>

            <fieldset className="batch-link-name-list">
              <legend className="batch-lab-section-title">Individual link names</legend>
              {linkTitles.slice(0, Number.parseInt(count, 10)).map((linkTitle, index) => (
                <label
                  className="batch-link-name-row"
                  htmlFor={`batch-link-title-${index + 1}`}
                  key={index}
                >
                  <span className="batch-link-number">{index + 1}</span>
                  <input
                    id={`batch-link-title-${index + 1}`}
                    maxLength={80}
                    onChange={(event) => changeLinkTitle(index, event.target.value)}
                    value={linkTitle}
                  />
                </label>
              ))}
            </fieldset>
            <div className="batch-lab-form-section">
              <span className="batch-lab-section-title">Timing and network fee</span>
              <div className="grid-two">
                <div>
                  <label className="label" htmlFor="batch-expiry">
                    Claim window
                  </label>
                  <input
                    id="batch-expiry"
                    inputMode="numeric"
                    onChange={(event) => setExpiryValue(event.target.value)}
                    value={expiryValue}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="batch-unit">
                    Unit
                  </label>
                  <select
                    id="batch-unit"
                    onChange={(event) =>
                      setExpiryUnit(event.target.value as ToccataCanaryExpiryUnit)
                    }
                    value={expiryUnit}
                  >
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                    <option value="minutes">Minutes</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="batch-fee">
                  Claim/refund fee per link
                </label>
                <input
                  id="batch-fee"
                  inputMode="decimal"
                  onChange={(event) => setFeeKas(event.target.value.replace(",", "."))}
                  value={feeKas}
                />
              </div>
              {batchCreationPreview ? (
                <div className="batch-amount-preview" aria-live="polite">
                  <div>
                    <span>Recipient gets</span>
                    <strong>{batchCreationPreview.netClaimKas} KAS</strong>
                  </div>
                  <div>
                    <span>Funding per link</span>
                    <strong>{batchCreationPreview.fundingPerLinkKas} KAS</strong>
                  </div>
                  <div>
                    <span>Exact batch total</span>
                    <strong>{batchCreationPreview.exactTotalKas} KAS</strong>
                  </div>
                  <p>Fees are included in the exact total.</p>
                </div>
              ) : null}
            </div>

            <p className="notice notice-warn batch-lab-exact-notice">
              Fund the exact total shown. Extra KAS cannot be distributed.
            </p>
            <button
              className="btn btn-primary"
              disabled={!enabled || !capabilities.ready || generating}
              type="submit"
            >
              {generating ? "Generating contracts..." : "Generate batch"}
            </button>
          </form>
        </section>

        <section className="card batch-lab-panel batch-lab-status-panel">
          <header className="batch-lab-panel-heading">
            <span className="batch-lab-step">2</span>
            <div>
              <span className="label">Fund and create outputs</span>
              <h2 className="form-section-heading">Batch status</h2>
              <p>Fund once, then create the individual claim links.</p>
            </div>
          </header>
          {batch && summary ? (
            <>
              <div className="batch-lab-stats">
                <div>
                  <span className="label">Waiting</span>
                  <strong>{summary.waiting}</strong>
                </div>
                <div>
                  <span className="label">Funded</span>
                  <strong>{summary.funded}</strong>
                </div>
                <div>
                  <span className="label">Closed</span>
                  <strong>{summary.closed}</strong>
                </div>
              </div>
              <p className="batch-lab-summary">
                <span>{batch.links.length} links</span>
                <span>{batch.links[0]?.netClaimKas} KAS claim each</span>
                <span>Valid for {batch.validFor}</span>
              </p>

              {batchExpiry ? (
                <p className="batch-lab-expiry">
                  {batchExpiry.expired ? (
                    <strong className="batch-lab-expired">
                      Claim window expired — refund path available
                    </strong>
                  ) : batchExpiry.remainingLabel ? (
                    <>
                      Claim window active — approx. <strong>{batchExpiry.remainingLabel}</strong>{" "}
                      remaining
                    </>
                  ) : null}
                </p>
              ) : null}

              <div
                className={`batch-recovery-before-funding${batch.recoveryExportedAt ? " is-complete" : ""}`}
              >
                <div>
                  <span className="label">Before funding</span>
                  <strong>Save your private recovery bundle</strong>
                  <p>Needed to recover unclaimed KAS on another device. Keep it private.</p>
                </div>
                <button
                  className={batch.recoveryExportedAt ? "btn" : "btn btn-primary"}
                  onClick={() => void downloadRecoveryFile()}
                  type="button"
                >
                  {batch.recoveryExportedAt ? "Download again" : "Download recovery bundle"}
                </button>
                {batch.recoveryExportedAt ? (
                  <span className="batch-recovery-saved">Recovery bundle saved</span>
                ) : null}
              </div>

              <div className="batch-lab-funding-callout">
                <span className="label">One-time batch address</span>
                <code className="batch-lab-address">{batch.activation.fundingAddress}</code>
                <div className="batch-lab-funding-amount">
                  <span>Exact total</span>
                  <strong>
                    {formatSompiForToccataLab(BigInt(batch.activation.fundingAmountSompi))} KAS
                  </strong>
                </div>
                <p className="muted">
                  Includes {formatSompiForToccataLab(BigInt(batch.activation.activationFeeSompi))}{" "}
                  KAS activation fee. {batchActivationStatusText(batch.activation.status)}
                </p>
                {batch.activation.status === "awaiting_funding" ? (
                  <div className="batch-funding-watch" aria-live="polite">
                    <span className="claimable-spinner" aria-hidden="true" />
                    <div>
                      <strong>Watching for funding</strong>
                      <p>Checking automatically.</p>
                    </div>
                  </div>
                ) : null}
                <div className="batch-lab-wallet-options">
                  {isTouchOnly === null ? (
                    <button className="btn btn-primary" disabled type="button">
                      Preparing wallet…
                    </button>
                  ) : isTouchOnly ? (
                    <button
                      className="btn btn-primary"
                      disabled={
                        generating ||
                        !batch.batchManifestRegisteredAt ||
                        !batch.recoveryExportedAt ||
                        batch.activation.status !== "awaiting_funding"
                      }
                      onClick={openBatchFundingWallet}
                      type="button"
                    >
                      Open in Kaspium
                    </button>
                  ) : (
                    <button
                      className="btn btn-primary"
                      disabled={
                        generating ||
                        !batch.batchManifestRegisteredAt ||
                        !batch.recoveryExportedAt ||
                        fundingWithKasware ||
                        batch.activation.status !== "awaiting_funding"
                      }
                      onClick={() => void fundBatchWithKasware()}
                      type="button"
                    >
                      {fundingWithKasware ? "Opening KasWare…" : "Fund with KasWare"}
                    </button>
                  )}
                  <button
                    className="btn"
                    disabled={!batch.batchManifestRegisteredAt || !batch.recoveryExportedAt}
                    onClick={() => void copyBatchFundingAddress()}
                    type="button"
                  >
                    Copy address
                  </button>
                  <button
                    aria-expanded={showFundingQr}
                    className="btn"
                    disabled={!batch.batchManifestRegisteredAt || !batch.recoveryExportedAt}
                    onClick={() => setShowFundingQr((current) => !current)}
                    type="button"
                  >
                    {showFundingQr ? "Hide QR code" : "Show QR code"}
                  </button>
                </div>
                {!batch.batchManifestRegisteredAt ? (
                  <div className="notice notice-warn">
                    <strong>Registration incomplete.</strong> Do not fund yet. Your private codes
                    are already encrypted locally; retry the idempotent public-metadata
                    registration.
                    <button
                      className="btn"
                      disabled={registering}
                      onClick={() => void completeBatchRegistration()}
                      type="button"
                    >
                      {registering ? "Registering links…" : "Finish link registration"}
                    </button>
                  </div>
                ) : null}
                {showFundingQr ? (
                  <div className="batch-lab-funding-qr">
                    <FundingQrCode
                      ariaLabel={`Funding QR code for ${batchFundingAmountKas} KAS`}
                      paymentUri={batchFundingWalletUri}
                    />
                    <div>
                      <strong>Scan with Kaspium</strong>
                      <p>Exact address and total included.</p>
                    </div>
                  </div>
                ) : null}
                {unmatchedFundingOutputs.length > 0 ? (
                  <div className="claimable-unmatched-funding notice notice-critical">
                    <span className="label">Batch total does not match</span>
                    <strong>
                      {unmatchedFundingOutputs.length} separate unexpected payment
                      {unmatchedFundingOutputs.length === 1 ? "" : "s"} detected
                    </strong>
                    <p>
                      This batch still expects exactly {batchFundingAmountKas} KAS. Do not send the
                      difference: separate UTXOs are not combined and cannot activate the batch.
                    </p>
                    {batchExpiry?.expired ? (
                      <>
                        <label className="label" htmlFor="unexpected-batch-refund-address">
                          Your Kaspa refund address
                        </label>
                        <input
                          id="unexpected-batch-refund-address"
                          onChange={(event) => setRefundAddress(event.target.value.trim())}
                          placeholder="kaspa:your-own-wallet-address"
                          value={refundAddress}
                        />
                        <label className="batch-lab-confirm">
                          <input
                            checked={refundConfirmed}
                            onChange={(event) => setRefundConfirmed(event.target.checked)}
                            type="checkbox"
                          />
                          I verified this destination. Recovery is signed locally with the private
                          batch refund code.
                        </label>
                      </>
                    ) : (
                      <p>
                        Each unexpected payment can be recovered after expiry
                        {batchExpiry?.remainingLabel
                          ? ` in about ${batchExpiry.remainingLabel}`
                          : ""}
                        . Keep the private recovery bundle safe.
                      </p>
                    )}
                    <div className="claimable-unmatched-list">
                      {unmatchedFundingOutputs.map((output) => {
                        const outputId = `${output.transactionId}:${output.outputIndex}`;
                        const recoverable =
                          BigInt(output.amountSompi) -
                            BigInt(batch.activation.activationFeeSompi) >=
                          TOCCATA_CANARY_MIN_OUTPUT_SOMPI;
                        return (
                          <div className="claimable-unmatched-row" key={outputId}>
                            <div>
                              <strong>
                                {formatSompiForToccataLab(BigInt(output.amountSompi))} KAS
                              </strong>
                              <p className="value-mono">
                                {compactTransactionId(output.transactionId)}:{output.outputIndex}
                              </p>
                            </div>
                            <a
                              href={kaspaStreamTransactionUrl(output.transactionId)}
                              rel="noreferrer"
                              target="_blank"
                            >
                              View transaction
                            </a>
                            <button
                              className="btn"
                              disabled={
                                !batchExpiry?.expired ||
                                !recoverable ||
                                !refundConfirmed ||
                                refundAddress.trim().length === 0 ||
                                recoveringOutputId !== ""
                              }
                              onClick={() => void recoverUnexpectedBatchFunding(output)}
                              type="button"
                            >
                              {recoveringOutputId === outputId
                                ? "Recovering..."
                                : batchExpiry?.expired
                                  ? "Recover payment"
                                  : "Recover after expiry"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {recoveryTxId ? (
                      <p className="success-text">
                        Recovery sent:{" "}
                        <a
                          href={kaspaStreamTransactionUrl(recoveryTxId)}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {compactTransactionId(recoveryTxId)}
                        </a>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="batch-lab-action-group">
                <span className="batch-lab-section-title">Create claim outputs</span>

                {batch.activation.status === "funded" ? (
                  <div className="batch-activation-review" role="note">
                    <div>
                      <span>Child outputs</span>
                      <strong>{batch.links.length}</strong>
                    </div>
                    <div>
                      <span>Total to children</span>
                      <strong>
                        {formatSompiForToccataLab(
                          batch.links.reduce((total, link) => total + BigInt(link.amountSompi), 0n),
                        )}{" "}
                        KAS
                      </strong>
                    </div>
                    <div>
                      <span>Activation fee</span>
                      <strong>
                        {formatSompiForToccataLab(BigInt(batch.activation.activationFeeSompi))} KAS
                      </strong>
                    </div>
                  </div>
                ) : null}

                {batch.activation.status === "funded" && batchExpiry?.expired ? (
                  <div className="notice notice-critical">
                    <strong>Activation window closed.</strong> The committed child links are already
                    expired, so this batch can now only be refunded as one unactivated output.
                  </div>
                ) : null}

                {batch.activation.status === "funded" ? (
                  <label className="batch-lab-confirm">
                    <input
                      type="checkbox"
                      checked={activationConfirmed}
                      onChange={(e) => setActivationConfirmed(e.target.checked)}
                    />{" "}
                    I understand this creates the fixed claim outputs and cannot be undone.
                  </label>
                ) : null}

                <div className="batch-lab-actions">
                  <button className="btn" onClick={downloadFundingPlan} type="button">
                    Funding plan
                  </button>
                  <button
                    className="btn"
                    disabled={checking}
                    onClick={() => {
                      setShowKaswareHelp(false);
                      void checkFunding();
                    }}
                    type="button"
                  >
                    {checking ? "Checking funding..." : "Check funding"}
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={
                      checking ||
                      batch.activation.status !== "funded" ||
                      !activationConfirmed ||
                      batchExpiry?.expired !== false
                    }
                    onClick={() => void activateBatch()}
                    type="button"
                  >
                    {checking && batch.activation.status === "funded"
                      ? "Creating outputs..."
                      : "Create claim outputs"}
                  </button>
                </div>
              </div>

              <div className="batch-lab-action-group">
                <span className="batch-lab-section-title">Share claim links</span>
                <div className="batch-lab-actions">
                  <button
                    className="btn"
                    disabled={summary.funded === 0}
                    onClick={downloadClaimLinks}
                    type="button"
                  >
                    Claim URLs
                  </button>
                  <button
                    className="btn"
                    disabled={summary.funded === 0}
                    onClick={() =>
                      void copyText(
                        batch.links
                          .filter(
                            (link) => link.status === "funded" && link.fundingMatch && !link.hidden,
                          )
                          .map((link) => buildClaimUrl(link, batch))
                          .join("\n"),
                        "All distributable claim links copied.",
                      )
                    }
                    type="button"
                  >
                    Copy all claim links
                  </button>
                  <input
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => void importRecoveryFile(event)}
                    ref={recoveryInputRef}
                    type="file"
                  />
                </div>
              </div>
              {batch.activation.status === "funded" ? (
                <div className="batch-lab-refund">
                  <span className="label">Fallback after expiry (non-custodial)</span>
                  <p className="muted">
                    If you decide not to create the claim outputs, after the window you can refund
                    the entire batch using your browser-held refund code. No server custody.
                  </p>
                  <div className="batch-refund-review">
                    <span>
                      Destination:{" "}
                      <strong>{refundAddress.trim() || "Enter an address below"}</strong>
                    </span>
                    <span>Refund amount before network fee: {batchFundingAmountKas} KAS</span>
                    <span>
                      Fee: {formatSompiForToccataLab(BigInt(batch.activation.activationFeeSompi))}{" "}
                      KAS
                    </span>
                    <span>
                      Available:{" "}
                      {batchExpiry?.expired
                        ? "Now"
                        : (batchExpiry?.remainingLabel ?? "Checking expiry")}
                    </span>
                  </div>
                  <label className="label" htmlFor="batch-refund-address">
                    Refund address
                  </label>
                  <input
                    id="batch-refund-address"
                    onChange={(event) => setRefundAddress(event.target.value)}
                    placeholder="kaspa:..."
                    value={refundAddress}
                  />
                  <label className="batch-lab-confirm">
                    <input
                      checked={refundConfirmed}
                      onChange={(event) => setRefundConfirmed(event.target.checked)}
                      type="checkbox"
                    />
                    I verified the destination address. The browser will sign the refund locally and
                    the server receives only the signed transaction.
                  </label>
                  <button
                    className="btn btn-danger"
                    disabled={
                      checking ||
                      refundAddress.trim().length === 0 ||
                      !refundConfirmed ||
                      batchExpiry?.expired !== true
                    }
                    onClick={() => void refundUnactivatedBatch()}
                    type="button"
                  >
                    Refund unactivated batch after expiry
                  </button>
                </div>
              ) : null}
              <div className="batch-lab-link-section" id="batch-created-links">
                <span className="batch-lab-section-title">Individual claim outputs</span>
                <p className="muted">
                  {summary.claimed} claimed · {batch.links.filter((link) => link.hidden).length}{" "}
                  marked do not distribute
                </p>
                <ul className="batch-lab-link-list">
                  {batch.links.map((link, index) => {
                    const claimUrl = buildClaimUrl(link, batch);
                    const isReady = !!link.fundingMatch && link.status === "funded";
                    return (
                      <li className="batch-lab-link-item" key={link.id}>
                        <span className="batch-link-number">{index + 1}</span>
                        <div className="batch-lab-link-copy">
                          <strong>{link.title}</strong>
                          <code title={link.fundingAddress}>
                            {compactAddress(link.fundingAddress)}
                          </code>
                        </div>
                        <span className={`batch-lab-link-status is-${link.status}`}>
                          {humanStatus(link.status)}
                        </span>

                        {isReady && claimUrl ? (
                          <div className="batch-link-actions">
                            {!link.hidden ? (
                              <>
                                <button
                                  className="btn"
                                  onClick={() => copyText(claimUrl, "Claim link copied.")}
                                  type="button"
                                >
                                  Copy
                                </button>
                                <button
                                  className="btn"
                                  onClick={() =>
                                    window.open(claimUrl, "_blank", "noopener,noreferrer")
                                  }
                                  type="button"
                                >
                                  Preview
                                </button>
                                <button
                                  className="btn"
                                  disabled={claimQrLoadingId === link.id}
                                  onClick={() => void showClaimQr(link)}
                                  type="button"
                                >
                                  {claimQrLoadingId === link.id ? "Building QR…" : "QR"}
                                </button>
                              </>
                            ) : null}
                            <button
                              className="btn"
                              onClick={() => void toggleDistribution(link.id)}
                              type="button"
                            >
                              {link.hidden ? "Include" : "Do not distribute"}
                            </button>
                          </div>
                        ) : null}

                        <div className="batch-link-recovery-actions">
                          <button
                            className="batch-lab-recovery-button"
                            disabled={!link.fundingMatch || isBatchLinkTerminal(link.status)}
                            onClick={() =>
                              copyText(buildRefundUrl(link, batch), "Private refund link copied.")
                            }
                            type="button"
                          >
                            Copy refund
                          </button>
                          <button
                            className="batch-lab-recovery-button"
                            disabled={!link.fundingMatch || isBatchLinkTerminal(link.status)}
                            onClick={() => openIndividualRefund(link)}
                            type="button"
                          >
                            Open refund
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {batch.activation.status === "activated" ? (
                  <p className="muted batch-lab-bearer-note">
                    Claim links contain the secret only in the URL fragment. They are non-custodial
                    bearer instruments — share carefully.
                  </p>
                ) : null}
              </div>
              <div className="batch-local-data-actions">
                <button
                  className="btn"
                  onClick={() => recoveryInputRef.current?.click()}
                  type="button"
                >
                  Import recovery bundle
                </button>
                <button
                  className="btn batch-lab-clear"
                  onClick={() => setShowClearDialog(true)}
                  type="button"
                >
                  Clear local batch
                </button>
              </div>
            </>
          ) : (
            <div className="batch-lab-empty">
              <strong>No batch created yet</strong>
              <p>
                Configure your drop on the left. All private codes (activation, claim, refund) are
                generated and kept only in this browser — fully non-custodial.
              </p>
              <input
                accept="application/json,.json"
                hidden
                onChange={(event) => void importRecoveryFile(event)}
                ref={recoveryInputRef}
                type="file"
              />
              <button
                className="btn"
                onClick={() => recoveryInputRef.current?.click()}
                type="button"
              >
                Import private recovery bundle
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function isBatchLinkTerminal(status: BatchLink["status"]): boolean {
  return isTerminalBatchChildStatus(status);
}

function isBatchLinkClosed(status: BatchLink["status"]): boolean {
  return status === "refundable" || isBatchLinkTerminal(status);
}

function readCreatorAuthHeaders(): Record<string, string> | null {
  const token = window.sessionStorage.getItem("kaspa-actions:creator-token") ?? "";
  const username = window.sessionStorage.getItem("kaspa-actions:creator-username") ?? "";
  if (!token || !username) return null;
  return {
    "content-type": "application/json",
    "x-creator-token": token,
    "x-creator-username": username,
  };
}

async function registerBatchClaimableLink(link: BatchLink): Promise<void> {
  const headers = readCreatorAuthHeaders();
  if (!headers) throw new Error("Creator session is required to register batch links.");
  const response = await fetch("/api/creator/claimable-links", {
    body: JSON.stringify({
      amountSompi: link.amountSompi,
      claimPublicKey: link.claimPublicKey,
      description: link.description,
      feeSompi: link.feeSompi,
      fundingAddress: link.fundingAddress,
      linkKey: link.id,
      redeemScriptHex: link.redeemScriptHex,
      refundLockTime: link.refundLockTime,
      refundPublicKey: link.refundPublicKey,
      title: link.title,
    }),
    headers,
    method: "POST",
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Could not register ${link.title}.`);
  }
}

async function registerAllBatchLinks(batch: BatchRecord): Promise<void> {
  for (const link of batch.links) await registerBatchClaimableLink(link);
  const headers = readCreatorAuthHeaders();
  if (!headers) throw new Error("Creator session is required to register the batch manifest.");
  const refundLockTime = batch.links[0]?.refundLockTime;
  if (!refundLockTime) throw new Error("Batch refund lock time is missing.");
  const response = await fetch("/api/creator/claimable-batches", {
    body: JSON.stringify({
      activationFeeSompi: batch.activation.activationFeeSompi,
      activationPublicKey: batch.activation.activationPublicKey,
      batchKey: batch.id,
      fundingAddress: batch.activation.fundingAddress,
      fundingAmountSompi: batch.activation.fundingAmountSompi,
      outputs: batch.links.map((link) => ({
        amountSompi: link.amountSompi,
        linkKey: link.id,
        scriptPublicKeyHex: link.scriptPublicKeyHex,
      })),
      redeemScriptHex: batch.activation.redeemScriptHex,
      refundLockTime,
      refundPublicKey: batch.activation.refundPublicKey,
      title: batch.title,
    }),
    headers,
    method: "POST",
  });
  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Could not register the public batch manifest.");
  }
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<number | string>>) {
  const escape = (value: number | string) => `"${String(value).replaceAll('"', '""')}"`;
  const text = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  downloadBlob(filename, new Blob([text], { type: "text/csv;charset=utf-8" }));
}

function downloadJson(filename: string, value: unknown) {
  downloadBlob(
    filename,
    new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json;charset=utf-8" }),
  );
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.position = "fixed";
  anchor.style.left = "-9999px";
  anchor.style.top = "0";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Mobile Safari may not consume the object URL until after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function readTextFile(file: File): Promise<string> {
  try {
    return await file.text();
  } catch {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("error", () => {
        reject(new Error("Could not read the recovery file. Save it locally and try again."));
      });
      reader.addEventListener("load", () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("The recovery file did not contain readable text."));
      });
      reader.readAsText(file);
    });
  }
}

function safeFilename(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "claimable-batch";
}

function friendlyBatchError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (/mass|script units|compute budget/i.test(message)) {
    return "Kaspa rejected the transaction because its mass or script budget was too high. Use fewer outputs or retry after consolidating wallet funds.";
  }
  if (/timed out|timeout|websocket|not connected/i.test(message)) {
    return "The Kaspa relay did not answer in time. Your browser-held codes are safe; wait a moment, check the status, and retry without rebuilding the batch.";
  }
  if (/lock time|until expiry|not available until/i.test(message)) {
    return "The refund path is not active yet. Wait until the on-chain DAA expiry is reached, then retry.";
  }
  if (/encrypt|vault secret|creator token/i.test(message)) {
    return "The private recovery data could not be encrypted locally. Sign in again before creating, importing, or changing this batch.";
  }
  return message || fallback;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function compactAddress(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function compactTransactionId(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function kaspaStreamTransactionUrl(transactionId: string): string {
  return `https://kaspa.stream/transactions/${encodeURIComponent(transactionId)}`;
}

function humanStatus(status: BatchLink["status"]): string {
  return status === "awaiting_activation"
    ? "Awaiting batch activation"
    : status === "funded"
      ? "Funded"
      : "Spent";
}

function recoveryLinkStatus(status: BatchLink["status"], refundReady: boolean): string {
  switch (status) {
    case "awaiting_activation":
      return "Not activated";
    case "funded":
      return refundReady ? "Ready to refund" : "Claimable";
    case "refundable":
      return "Ready to refund";
    case "claimed":
      return "Claimed";
    case "refunded":
      return "Refunded to wallet";
    case "spent_unknown":
    case "spent":
      return "Spent on-chain";
  }
}

function batchActivationStatusText(status: BatchRecord["activation"]["status"]): string {
  switch (status) {
    case "awaiting_funding":
      return "Waiting for the exact funding output.";
    case "funded":
      return "Funding found. Create the claim outputs next (browser-signed).";
    case "activated":
      return "Claim outputs created. Individual links are ready to share.";
    case "refunded":
      return "The unactivated batch was refunded.";
  }
}

function serializeScriptPublicKey(value: { script: string; version: number }): string {
  return value.version.toString(16).padStart(4, "0") + value.script.toLowerCase();
}

function defaultLinkTitles(count: number): string[] {
  const examples = [
    "X giveaway",
    "Discord community",
    "Telegram community",
    "Community reward",
    "Creator drop",
    "Stream reward",
    "Early supporter reward",
    "Newsletter giveaway",
    "Partner community",
    "Final giveaway slot",
  ];
  return Array.from({ length: count }, (_, index) => examples[index] ?? `Claim link #${index + 1}`);
}

function resizeLinkTitles(current: string[], count: number): string[] {
  const defaults = defaultLinkTitles(count);
  return Array.from({ length: count }, (_, index) => current[index] ?? defaults[index]!);
}
