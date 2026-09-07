"use client";

import { TelegramGiveawayActions } from "./TelegramGiveawayActions";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  connectKaswareWallet,
  getKaswareProvider,
  isKaswareInstalled,
  sendKaspaPayment,
} from "@kaspa-actions/wallet-adapter";

import { SignInClient } from "@/app/sign-in/SignInClient";
import { CreateProfileClient } from "@/app/create-profile/CreateProfileClient";
import {
  giveawaySetupSchema,
  validateGiveawaySetup,
  giveawayProgress,
  giveawayFundingDeadline,
} from "./giveaway-setup";
import {
  buildClaimableSpendInBrowser,
  preloadClaimableBrowserSigner,
} from "@/app/toccata-lab/claimable-browser";
import { loadClaimableRecords, saveClaimableRecord } from "@/lib/claimable-store";
import { ensureTelegramMiniAppVaultSecret } from "@/lib/claimable-vault";
import { FundingQrCode } from "@/lib/funding-qr";
import {
  createGiveawayPrizeRecoveryBundle,
  parseGiveawayPrizeRecoveryBundle,
  prizeRecoveryToLocalRecord,
  type GiveawayPrizeRecoveryRecord,
} from "@/lib/giveaway-prize-recovery";
import {
  giveawayRefundDelaySeconds,
  shouldPrepareGiveawayClaim,
} from "@/lib/giveaway-prize-shared";
import { buildClaimableManageUrl } from "@/lib/claimable-share";
import { planToccataCanaryClaimFromNetKas } from "@/lib/toccata-lab-fee";
import { createToccataLabKeyPair } from "@/lib/toccata-lab-keys";
import { readJsonResponse } from "@/lib/response-json";
import { kaspaStreamTransactionUrl } from "@/lib/kaspa-stream";
import { buildWalletLaunchUri } from "@/lib/wallet-uri";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";
const GIVEAWAY_POLL_MS = 5_000;

type GiveawayStatus = "CANCELLED" | "CLOSED" | "DRAWN" | "NO_ENTRIES" | "OPEN" | "PENDING_FUNDING";

type GiveawaySummary = {
  amountKas: string;
  closesAt: string;
  createdAt?: string;
  fundingExpiresAt?: string | null;
  description: null | string;
  drawCommitment: string;
  drawProtocol: {
    entropyBlockBlueScore: null | string;
    entropyBlockHash: null | string;
    entropyTargetBlueScore: null | string;
    entriesFrozenAt: null | string;
    entriesRoot: null | string;
    entryCount: null | number;
    freezeCommitment?: null | string;
    version: number;
  };
  drawProof: null | {
    digest: null | string;
    entryCount: null | number;
    seed: string;
    winnerIndex: null | number;
  };
  entryCount: number;
  entryWindowSeconds?: number;
  prize: null | {
    amountSompi: string;
    claimPublicKey: string;
    claimTxId: null | string;
    feeSompi: string;
    funded: boolean;
    fundingAddress: string;
    fundingOutputIndex: null | number;
    fundingTxId: null | string;
    linkKey: string;
    redeemScriptHex: string;
    refundLockTime: string;
    refundPublicKey: string;
    status: string;
  };
  publicId: string;
  publicUrl: string;
  status: GiveawayStatus;
  title: string;
  winnerClaim: {
    expiresAt: null | string;
    preparedAt: null | string;
    preparedTransactionId: null | string;
    windowSeconds: null | number;
  };
  winnerAddress: null | string;
};

type Session =
  | { initData: string; kind: "telegram" }
  | { kind: "creator"; token: string; username: string };

type PrizeEscrow = GiveawayPrizeRecoveryRecord;

function durationFields(seconds: number): {
  unit: "days" | "hours" | "minutes";
  value: string;
} {
  if (seconds % 86_400 === 0) return { unit: "days", value: String(seconds / 86_400) };
  if (seconds % 3_600 === 0) return { unit: "hours", value: String(seconds / 3_600) };
  return { unit: "minutes", value: String(Math.max(1, Math.ceil(seconds / 60))) };
}

export function GiveawayLabClient({
  draftId,
  templateId,
  botUsername = "",
  enabled,
}: {
  draftId?: string;
  templateId?: string;
  botUsername?: string;
  enabled: boolean;
}) {
  const [stage, setStage] = useState<"details" | "access" | "fund" | "share" | "manage">("details");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const setupHeading = useRef<HTMLHeadingElement>(null);
  const storageKey = `kaspa-links:giveaway-setup:${draftId ?? templateId ?? "new"}`;
  const restoredSettingsRef = useRef(false);
  const resumeIdRef = useRef<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [session, setSession] = useState<null | Session>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [giveaways, setGiveaways] = useState<GiveawaySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [drawingId, setDrawingId] = useState<null | string>(null);
  const [deletingId, setDeletingId] = useState<null | string>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<null | GiveawaySummary>(null);
  const [error, setError] = useState<null | string>(null);
  const [notice, setNotice] = useState<null | string>(null);
  const [now, setNow] = useState(() => Date.now());
  const [title, setTitle] = useState("Weekend KAS giveaway");
  const [description, setDescription] = useState("Enter your Kaspa address for a chance to win.");
  const [amountKas, setAmountKas] = useState("10");
  const [durationValue, setDurationValue] = useState("24");
  const [durationUnit, setDurationUnit] = useState<"days" | "hours" | "minutes">("hours");
  const [winnerClaimValue, setWinnerClaimValue] = useState("24");
  const [winnerClaimUnit, setWinnerClaimUnit] = useState<"days" | "hours" | "minutes">("hours");
  const [qrById, setQrById] = useState<Record<string, string>>({});
  const [payingId, setPayingId] = useState<null | string>(null);
  const [payoutTxById, setPayoutTxById] = useState<Record<string, string>>({});
  const [createdGiveaway, setCreatedGiveaway] = useState<null | GiveawaySummary>(null);
  const [createdEscrow, setCreatedEscrow] = useState<null | PrizeEscrow>(null);
  const [escrowPrize, setEscrowPrize] = useState(true);
  const [autoPrepareClaim, setAutoPrepareClaim] = useState(true);
  const [kaswareAvailable, setKaswareAvailable] = useState(false);
  const [prizeRecoveryReady, setPrizeRecoveryReady] = useState(false);
  const [prizeRecoverySkipped, setPrizeRecoverySkipped] = useState(false);
  const [prizeRecoveryAccessByLink, setPrizeRecoveryAccessByLink] = useState<
    Record<string, boolean>
  >({});
  const [prizeAutoPrepareByLink, setPrizeAutoPrepareByLink] = useState<Record<string, boolean>>({});
  const [restoringPrize, setRestoringPrize] = useState(false);
  const autoDrawInFlightRef = useRef(new Set<string>());
  const autoDrawLastAttemptRef = useRef(new Map<string, number>());
  const autoPrepareInFlightRef = useRef(new Set<string>());
  const autoPrepareLastAttemptRef = useRef(new Map<string, number>());
  const loadedDraftRef = useRef<null | string>(null);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      const saved = raw ? giveawaySetupSchema.safeParse(JSON.parse(raw)) : null;
      if (saved?.success) {
        restoredSettingsRef.current = true;
        const v = saved.data;
        setTitle(v.title);
        setDescription(v.description);
        setAmountKas(v.amountKas);
        setDurationValue(v.durationValue);
        setDurationUnit(v.durationUnit);
        setWinnerClaimValue(v.winnerClaimValue);
        setWinnerClaimUnit(v.winnerClaimUnit);
        setEscrowPrize(v.escrowPrize);
        setAutoPrepareClaim(v.autoPrepareClaim);
      }
      resumeIdRef.current = window.sessionStorage.getItem(`${storageKey}:active`);
    } catch {
      /* Public draft persistence is optional. */
    }
    setSettingsReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!settingsReady || !restoredSettingsRef.current) return;
    try {
      window.sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          title,
          description,
          amountKas,
          durationValue,
          durationUnit,
          winnerClaimValue,
          winnerClaimUnit,
          escrowPrize,
          autoPrepareClaim,
        }),
      );
    } catch {
      /* Keep the in-memory form usable if storage is unavailable. */
    }
  }, [
    settingsReady,
    storageKey,
    title,
    description,
    amountKas,
    durationValue,
    durationUnit,
    winnerClaimValue,
    winnerClaimUnit,
    escrowPrize,
    autoPrepareClaim,
  ]);

  useEffect(() => {
    setupHeading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [stage, createdGiveaway?.publicId]);

  const acceptIdentity = useCallback((identity: { username: string; token: string }) => {
    setSession({ kind: "creator", ...identity });
    setError(null);
  }, []);

  function currentSettings() {
    return {
      title,
      description,
      amountKas,
      durationValue,
      durationUnit,
      winnerClaimValue,
      winnerClaimUnit,
      escrowPrize,
      autoPrepareClaim,
    };
  }
  function continueSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      validateGiveawaySetup(currentSettings());
      setError(null);
      setNotice(null);
      setStage("access");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Check the giveaway details.");
    }
  }
  function rememberActive(publicId: string | null) {
    try {
      if (publicId) window.sessionStorage.setItem(`${storageKey}:active`, publicId);
      else window.sessionStorage.removeItem(`${storageKey}:active`);
    } catch {
      /* The giveaway remains accessible through its management card. */
    }
  }
  function showManage() {
    setCreatedGiveaway(null);
    setCreatedEscrow(null);
    rememberActive(null);
    setStage("manage");
  }

  useEffect(() => {
    const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ?? "";
    const username = window.sessionStorage.getItem(USERNAME_STORAGE_KEY)?.trim() ?? "";
    if (token && username) {
      setSession({ kind: "creator", token, username });
      setSessionReady(true);
      return;
    }
    const telegramWebApp = window.Telegram?.WebApp;
    const initData = telegramWebApp?.initData?.trim() ?? "";
    if (initData) {
      ensureTelegramMiniAppVaultSecret();
      telegramWebApp?.ready();
      telegramWebApp?.expand();
      setSession({ initData, kind: "telegram" });
      setSessionReady(true);
      return;
    }
    setSession(null);
    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!deleteCandidate) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDeleteCandidate(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteCandidate]);

  // KasWare is a desktop extension; on phones we keep the kaspa: deep link.
  useEffect(() => {
    setKaswareAvailable(isKaswareInstalled());
  }, []);

  // The countdown only needs to tick while something is actually counting down.
  useEffect(() => {
    if (
      !giveaways.some((giveaway) => ["OPEN", "PENDING_FUNDING", "DRAWN"].includes(giveaway.status))
    )
      return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [giveaways]);

  const creatorHeaders = useMemo<Headers | null>(() => {
    if (!session) return null;
    const headers = new Headers({ "Content-Type": "application/json" });
    if (session.kind === "creator") {
      headers.set("x-creator-token", session.token);
      headers.set("x-creator-username", session.username);
    } else {
      headers.set("x-telegram-mini-app-init-data", session.initData);
    }
    return headers;
  }, [session]);

  useEffect(() => {
    if (
      !draftId ||
      !creatorHeaders ||
      loadedDraftRef.current === draftId ||
      restoredSettingsRef.current
    )
      return;
    loadedDraftRef.current = draftId;
    void (async () => {
      try {
        const response = await fetch(
          `/api/creator/agent/giveaway-drafts/${encodeURIComponent(draftId)}`,
          { cache: "no-store", headers: creatorHeaders },
        );
        const body = await readJsonResponse<{
          draft?: {
            amountKas: string;
            entryWindowSeconds: number;
            title: string;
            winnerClaimWindowSeconds: number;
          };
          error?: { message?: string };
        }>(response);
        if (!response.ok || !body?.draft) {
          throw new Error(body?.error?.message ?? "Telegram giveaway draft could not be loaded.");
        }
        if (restoredSettingsRef.current) return;
        const entryWindow = durationFields(body.draft.entryWindowSeconds);
        const winnerWindow = durationFields(body.draft.winnerClaimWindowSeconds);
        restoredSettingsRef.current = true;
        setAmountKas(body.draft.amountKas);
        setDurationUnit(entryWindow.unit);
        setDurationValue(entryWindow.value);
        setTitle(body.draft.title);
        setWinnerClaimUnit(winnerWindow.unit);
        setWinnerClaimValue(winnerWindow.value);
        setNotice("Giveaway details loaded from Telegram.");
      } catch (caught) {
        loadedDraftRef.current = null;
        setError(
          caught instanceof Error ? caught.message : "Telegram giveaway draft could not be loaded.",
        );
      }
    })();
  }, [creatorHeaders, draftId]);

  useEffect(() => {
    if (
      draftId ||
      !templateId ||
      restoredSettingsRef.current ||
      !/^[a-zA-Z0-9_-]{1,48}$/.test(templateId)
    )
      return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/toccata-lab/giveaways/${templateId}`, {
          cache: "no-store",
        });
        const body = await readJsonResponse<{
          giveaway?: { amountKas: string; title: string; entryWindowSeconds?: number | null };
        }>(response);
        if (!response.ok || !body?.giveaway)
          throw new Error("Giveaway template could not be loaded.");
        if (cancelled || restoredSettingsRef.current) return;
        restoredSettingsRef.current = true;
        setTitle(body.giveaway.title);
        setAmountKas(body.giveaway.amountKas);
        const seconds = body.giveaway.entryWindowSeconds ?? 86400;
        const duration = durationFields(Math.min(604800, Math.max(60, seconds)));
        setDurationUnit(duration.unit);
        setDurationValue(duration.value);
        setNotice("Template loaded. Make it your own.");
      } catch {
        if (!cancelled) setError("Template unavailable. You can still create your own giveaway.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, templateId]);

  const loadGiveaways = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      if (!creatorHeaders) return;
      if (!options.quiet) setLoading(true);
      try {
        const response = await fetch("/api/toccata-lab/giveaways", {
          cache: "no-store",
          headers: creatorHeaders,
        });
        const body = (await response.json()) as {
          error?: { message?: string };
          giveaways?: GiveawaySummary[];
        };
        if (response.status === 401 || response.status === 403) {
          setSession(null);
          return;
        }
        if (!response.ok) throw new Error(body.error?.message ?? "Giveaways could not be loaded.");
        setGiveaways(body.giveaways ?? []);
        if (!options.quiet) setError(null);
      } catch (caught) {
        // A failed background poll must not replace what the creator is reading.
        if (!options.quiet) {
          setError(caught instanceof Error ? caught.message : "Giveaways could not be loaded.");
        }
      } finally {
        if (!options.quiet) setLoading(false);
      }
    },
    [creatorHeaders],
  );

  useEffect(() => {
    void loadGiveaways();
  }, [loadGiveaways]);

  // While entries are open the creator is watching the counter, so keep it live
  // instead of making them press Refresh. Idle accounts poll nothing at all.
  const hasActiveGiveaway = useMemo(
    () =>
      giveaways.some((giveaway) =>
        ["OPEN", "PENDING_FUNDING", "CLOSED", "DRAWN"].includes(giveaway.status),
      ),
    [giveaways],
  );

  useEffect(() => {
    if (!hasActiveGiveaway || !creatorHeaders) return;
    const timer = window.setInterval(() => void loadGiveaways({ quiet: true }), GIVEAWAY_POLL_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadGiveaways({ quiet: true });
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [creatorHeaders, hasActiveGiveaway, loadGiveaways]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void loadClaimableRecords()
      .then((records) => {
        if (cancelled) return;
        setPrizeRecoveryAccessByLink(
          Object.fromEntries(
            records.map((record) => [
              record.id,
              Boolean(record.recoveryExportedAt || record.recoveryBackupSkippedAt),
            ]),
          ),
        );
        setPrizeAutoPrepareByLink(
          Object.fromEntries(
            records.map((record) => [
              record.id,
              record.giveawayAutoPrepareEnabled === true ||
                record.giveawayAutoPayoutEnabled === true,
            ]),
          ),
        );
      })
      .catch(() => {
        // Missing local recovery data is handled at the point where the
        // creator downloads, funds, or pays the prize.
      });
    return () => {
      cancelled = true;
    };
  }, [giveaways, session]);

  const resumeSetup = useCallback(
    async (giveaway: GiveawaySummary) => {
      setNow(Date.now());
      setCreatedGiveaway(giveaway);
      setCreatedEscrow(null);
      setPrizeRecoveryReady(false);
      setPrizeRecoverySkipped(false);
      setStage("access");
      setError(null);
      setNotice(null);
      try {
        window.sessionStorage.setItem(`${storageKey}:active`, giveaway.publicId);
      } catch {
        /* Optional resume pointer. */
      }
      if (!giveaway.prize) {
        setStage("share");
        return;
      }
      try {
        const local = (await loadClaimableRecords()).find(
          (record) => record.id === giveaway.prize!.linkKey,
        );
        if (!local?.claimCode || !local.refundCode) return;
        const prize = giveaway.prize;
        setCreatedEscrow({
          amountKas: sompiToKas(prize.amountSompi),
          amountSompi: prize.amountSompi,
          claimCode: local.claimCode,
          claimPublicKey: prize.claimPublicKey,
          refundCode: local.refundCode,
          refundPublicKey: prize.refundPublicKey,
          createdAt: local.createdAt,
          createdAtMs: local.createdAtMs,
          description: local.description,
          feeKas: sompiToKas(prize.feeSompi),
          feeSompi: prize.feeSompi,
          fundingAddress: prize.fundingAddress,
          linkKey: prize.linkKey,
          netClaimKas: giveaway.amountKas,
          redeemScriptHex: prize.redeemScriptHex,
          refundLockTime: prize.refundLockTime,
          title: giveaway.title,
        });
        setPrizeRecoveryReady(Boolean(local.recoveryExportedAt));
        setPrizeRecoverySkipped(Boolean(local.recoveryBackupSkippedAt));
        if (local.recoveryExportedAt || local.recoveryBackupSkippedAt) setStage("fund");
      } catch {
        setError("Restore your recovery file to continue on this device.");
      }
    },
    [storageKey],
  );

  useEffect(() => {
    const id = resumeIdRef.current;
    if (!id || !giveaways.length) return;
    const giveaway = giveaways.find((item) => item.publicId === id);
    resumeIdRef.current = null;
    if (giveaway?.status === "PENDING_FUNDING") void resumeSetup(giveaway);
    else if (giveaway) {
      setStage("manage");
      setExpandedId(giveaway.publicId);
    }
  }, [giveaways, resumeSetup]);

  useEffect(() => {
    if (!createdGiveaway) return;
    const current =
      giveaways.find((item) => item.publicId === createdGiveaway.publicId) ?? createdGiveaway;
    if (
      current.status === "OPEN" &&
      (!current.prize ||
        (current.prize.funded &&
          !["claimed", "refunded", "spent_unknown"].includes(current.prize.status)))
    ) {
      setStage("share");
    } else if (current.status !== "PENDING_FUNDING") {
      setCreatedGiveaway(null);
      setStage("manage");
      setExpandedId(current.publicId);
    }
  }, [giveaways, createdGiveaway]);

  // Parks the prize in a claimable link before the giveaway exists. Both codes
  // are generated here and only ever leave this browser inside the encrypted
  // vault — the server receives public keys and the script, nothing spendable.
  async function createPrizeEscrow(
    netAmountKas: string,
    entryWindowSeconds: number,
    winnerClaimWindowSeconds: number,
  ): Promise<PrizeEscrow> {
    if (!creatorHeaders) throw new Error("Reopen this giveaway from Telegram or sign in again.");

    const plan = planToccataCanaryClaimFromNetKas({ netAmountKas });
    const claimKey = createToccataLabKeyPair();
    const refundKey = createToccataLabKeyPair();

    const dagResponse = await fetch("/api/toccata-lab/dag-info");
    const dagBody = (await dagResponse.json()) as {
      error?: { message?: string };
      virtualDaaScore?: string;
    };
    const currentDaaScore = dagBody.virtualDaaScore;
    if (!dagResponse.ok || !currentDaaScore) {
      throw new Error(
        dagBody.error?.message ?? "The Kaspa DAA score is unavailable — try again shortly.",
      );
    }
    const refundLockTime = (
      BigInt(currentDaaScore) +
      BigInt(giveawayRefundDelaySeconds(entryWindowSeconds, winnerClaimWindowSeconds)) * 10n
    ).toString();

    const scriptResponse = await fetch("/api/toccata-lab/claimable-script", {
      body: JSON.stringify({
        linkPublicKey: claimKey.xOnlyPublicKey,
        refundLockTime,
        refundPublicKey: refundKey.xOnlyPublicKey,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const scriptBody = (await scriptResponse.json()) as {
      error?: { message?: string };
      script?: { fundingAddress: string; redeemScriptHex: string };
    };
    if (!scriptResponse.ok || !scriptBody.script) {
      throw new Error(scriptBody.error?.message ?? "The prize contract could not be built.");
    }

    const linkKey = `giveaway-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const registerResponse = await fetch("/api/creator/claimable-links", {
      body: JSON.stringify({
        amountSompi: plan.utxoSompi.toString(),
        claimPublicKey: claimKey.xOnlyPublicKey,
        description: `Prize escrow for “${title.trim()}”`,
        feeSompi: plan.feeSompi.toString(),
        fundingAddress: scriptBody.script.fundingAddress,
        linkKey,
        redeemScriptHex: scriptBody.script.redeemScriptHex,
        refundLockTime,
        refundPublicKey: refundKey.xOnlyPublicKey,
        title: title.trim().slice(0, 80) || "Giveaway prize",
      }),
      headers: creatorHeaders,
      method: "POST",
    });
    const registerBody = (await registerResponse.json()) as { error?: { message?: string } };
    if (!registerResponse.ok) {
      throw new Error(registerBody.error?.message ?? "The prize could not be registered.");
    }

    // Store the recovery data before showing the funding address: money must
    // never be sent to an address whose refund code is not durably saved.
    const createdAt = new Date();
    const recoveryRecord: PrizeEscrow = {
      amountKas: plan.utxoKas,
      claimCode: claimKey.privateKey,
      claimPublicKey: claimKey.xOnlyPublicKey,
      createdAt: createdAt.toISOString(),
      createdAtMs: createdAt.getTime(),
      description: `Prize escrow for “${title.trim()}”`,
      feeKas: plan.feeKas,
      feeSompi: plan.feeSompi.toString(),
      fundingAddress: scriptBody.script.fundingAddress,
      amountSompi: plan.utxoSompi.toString(),
      linkKey,
      netClaimKas: plan.netOutputKas,
      redeemScriptHex: scriptBody.script.redeemScriptHex,
      refundCode: refundKey.privateKey,
      refundLockTime,
      refundPublicKey: refundKey.xOnlyPublicKey,
      title: title.trim() || "Giveaway prize",
    };
    await saveClaimableRecord({
      ...prizeRecoveryToLocalRecord(recoveryRecord),
      updatedAtMs: createdAt.getTime(),
    });
    return recoveryRecord;
  }

  async function createGiveaway() {
    if (!creatorHeaders) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const { entryWindowSeconds, winnerClaimWindowSeconds } =
        validateGiveawaySetup(currentSettings());
      const closesAt = new Date(Date.now() + entryWindowSeconds * 1000).toISOString();

      // Escrow first: if parking the prize fails, no giveaway is advertised.
      let escrow: null | PrizeEscrow = null;
      if (escrowPrize) {
        escrow = await createPrizeEscrow(amountKas, entryWindowSeconds, winnerClaimWindowSeconds);
      }

      const response = await fetch("/api/toccata-lab/giveaways", {
        body: JSON.stringify({
          amountKas,
          closesAt,
          description,
          prizeLinkKey: escrow?.linkKey ?? null,
          title,
          winnerClaimWindowSeconds,
        }),
        headers: creatorHeaders,
        method: "POST",
      });
      const body = await readJsonResponse<{
        error?: { message?: string };
        giveaway?: GiveawaySummary;
      }>(response);
      if (!response.ok || !body?.giveaway) {
        throw new Error(body?.error?.message ?? "Giveaway could not be created. Please try again.");
      }
      if (escrow) {
        try {
          const records = await loadClaimableRecords();
          const local = records.find((record) => record.id === escrow.linkKey);
          if (!local) throw new Error("Local prize recovery data is missing.");
          await saveClaimableRecord({
            ...local,
            giveawayAutoPrepareEnabled: autoPrepareClaim,
            giveawayAutoPayoutEnabled: false,
            giveawayPublicId: body.giveaway.publicId,
            updatedAtMs: Date.now(),
          });
          setPrizeAutoPrepareByLink((current) => ({
            ...current,
            [escrow.linkKey]: autoPrepareClaim,
          }));
        } catch {
          setNotice(
            "Giveaway created, but automatic claim preparation could not be saved. You can prepare it manually after the draw.",
          );
        }
      }
      setGiveaways((current) => [body.giveaway!, ...current]);
      setNow(Date.now());
      setCreatedGiveaway(body.giveaway);
      setCreatedEscrow(escrow);
      rememberActive(body.giveaway.publicId);
      setStage(escrow ? "access" : "share");
      setPrizeRecoveryReady(false);
      setPrizeRecoverySkipped(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giveaway could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  const drawWinner = useCallback(
    async (publicId: string) => {
      if (!creatorHeaders) return;
      setDrawingId(publicId);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(`/api/toccata-lab/giveaways/${publicId}/draw`, {
          headers: creatorHeaders,
          method: "POST",
        });
        const body = (await response.json()) as {
          error?: { message?: string };
          giveaway?: {
            drawProof: GiveawaySummary["drawProof"];
            drawProtocol: GiveawaySummary["drawProtocol"];
            status: GiveawayStatus;
            winnerAddress: null | string;
            winnerClaimExpiresAt: null | string;
          };
        };
        if (!response.ok || !body.giveaway) {
          throw new Error(body.error?.message ?? "Winner could not be drawn.");
        }
        setGiveaways((current) =>
          current.map((giveaway) =>
            giveaway.publicId === publicId
              ? {
                  ...giveaway,
                  drawProof: body.giveaway!.drawProof,
                  drawProtocol: body.giveaway!.drawProtocol,
                  status: body.giveaway!.status,
                  winnerAddress: body.giveaway!.winnerAddress,
                  winnerClaim: {
                    ...giveaway.winnerClaim,
                    expiresAt: body.giveaway!.winnerClaimExpiresAt,
                  },
                }
              : giveaway,
          ),
        );
        setNotice(
          body.giveaway.status === "DRAWN"
            ? giveaways.find((giveaway) => giveaway.publicId === publicId)?.prize
              ? "Winner drawn. This browser can now prepare the fixed-address winner claim."
              : "Winner drawn. Review the address before paying from your wallet."
            : body.giveaway.status === "CLOSED"
              ? "Entries frozen. Waiting for the preselected future Kaspa chain block."
              : "Giveaway closed without entries.",
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Winner could not be drawn.");
      } finally {
        setDrawingId(null);
      }
    },
    [creatorHeaders, giveaways],
  );

  async function deleteGiveaway(giveaway: GiveawaySummary): Promise<void> {
    if (!creatorHeaders) return;
    setDeletingId(giveaway.publicId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/toccata-lab/giveaways/${giveaway.publicId}`, {
        headers: creatorHeaders,
        method: "DELETE",
      });
      const body = await readJsonResponse<{
        deleted?: boolean;
        error?: { message?: string };
      }>(response);
      if (!response.ok || !body?.deleted) {
        throw new Error(body?.error?.message ?? "Giveaway could not be deleted.");
      }
      setGiveaways((current) => current.filter((item) => item.publicId !== giveaway.publicId));
      setCreatedGiveaway((current) => (current?.publicId === giveaway.publicId ? null : current));
      setDeleteCandidate(null);
      setNotice("Giveaway deleted. No funds or on-chain records were moved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Giveaway could not be deleted.");
      setDeleteCandidate(null);
    } finally {
      setDeletingId(null);
    }
  }

  // Drawing is public and deterministic, so the creator browser can finalize
  // the result as soon as the stored entry window closes. The route remains
  // transaction-safe if another open entry page reaches it at the same time.
  useEffect(() => {
    const findCandidate = () =>
      giveaways.find(
        (giveaway) =>
          giveaway.status === "CLOSED" ||
          (giveaway.status === "OPEN" && new Date(giveaway.closesAt).getTime() <= Date.now()),
      );

    const attemptDraw = () => {
      const candidate = findCandidate();
      if (!candidate || autoDrawInFlightRef.current.has(candidate.publicId)) return;
      const lastAttempt = autoDrawLastAttemptRef.current.get(candidate.publicId) ?? 0;
      if (Date.now() - lastAttempt < 5_000) return;

      autoDrawLastAttemptRef.current.set(candidate.publicId, Date.now());
      autoDrawInFlightRef.current.add(candidate.publicId);
      void drawWinner(candidate.publicId).finally(() => {
        autoDrawInFlightRef.current.delete(candidate.publicId);
      });
    };

    if (!findCandidate()) return;
    attemptDraw();
    const timer = window.setInterval(attemptDraw, 5_000);
    return () => window.clearInterval(timer);
  }, [drawWinner, giveaways, now]);

  async function downloadPrizeRecovery(prize: PrizeEscrow | null = createdEscrow) {
    if (!prize) return;
    try {
      const bundle = createGiveawayPrizeRecoveryBundle(prize);
      const filename = `${safeFilePart(prize.title)}-prize-recovery.json`;
      const file = new File([JSON.stringify(bundle, null, 2)], filename, {
        type: "application/json",
      });
      if (
        session?.kind === "telegram" &&
        typeof navigator.share === "function" &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({ files: [file], title: "KaspaLinks prize recovery" });
      } else {
        const href = URL.createObjectURL(file);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
      }
      setPrizeRecoveryReady(true);
      setPrizeRecoverySkipped(false);
      const records = await loadClaimableRecords();
      const local = records.find((record) => record.id === prize.linkKey);
      if (local) {
        await saveClaimableRecord({
          ...local,
          recoveryExportedAt: new Date().toISOString(),
          recoveryBackupSkippedAt: undefined,
          updatedAtMs: Date.now(),
        });
      }
      setPrizeRecoveryAccessByLink((current) => ({ ...current, [prize.linkKey]: true }));
      setNotice("Private prize recovery bundle saved.");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(
        caught instanceof Error ? caught.message : "Prize recovery could not be downloaded.",
      );
    }
  }

  async function downloadExistingPrizeRecovery(giveaway: GiveawaySummary): Promise<void> {
    if (!giveaway.prize) return;
    setError(null);
    try {
      const local = (await loadClaimableRecords()).find(
        (record) => record.id === giveaway.prize!.linkKey,
      );
      if (!local?.claimCode || !local.refundCode) {
        throw new Error(
          "This browser does not have the private prize keys. Restore the private recovery bundle first.",
        );
      }
      await downloadPrizeRecovery({
        amountKas: sompiToKas(giveaway.prize.amountSompi),
        amountSompi: giveaway.prize.amountSompi,
        claimCode: local.claimCode,
        claimPublicKey: giveaway.prize.claimPublicKey,
        createdAt: local.createdAt,
        createdAtMs: local.createdAtMs,
        description: local.description,
        feeKas: sompiToKas(giveaway.prize.feeSompi),
        feeSompi: giveaway.prize.feeSompi,
        fundingAddress: giveaway.prize.fundingAddress,
        linkKey: giveaway.prize.linkKey,
        netClaimKas: giveaway.amountKas,
        redeemScriptHex: giveaway.prize.redeemScriptHex,
        refundCode: local.refundCode,
        refundLockTime: giveaway.prize.refundLockTime,
        refundPublicKey: giveaway.prize.refundPublicKey,
        title: giveaway.title,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Prize recovery could not be downloaded.",
      );
    }
  }

  async function markPrizeRecoveryRiskAccepted(checked: boolean): Promise<void> {
    if (!createdEscrow) return;
    setPrizeRecoverySkipped(checked);
    if (checked) setPrizeRecoveryReady(false);
    const records = await loadClaimableRecords();
    const local = records.find((record) => record.id === createdEscrow.linkKey);
    if (!local) return;
    await saveClaimableRecord({
      ...local,
      recoveryBackupSkippedAt: checked ? new Date().toISOString() : undefined,
      recoveryExportedAt: checked ? undefined : local.recoveryExportedAt,
      updatedAtMs: Date.now(),
    });
    setPrizeRecoveryAccessByLink((current) => ({
      ...current,
      [createdEscrow.linkKey]: checked || Boolean(local.recoveryExportedAt),
    }));
  }

  async function restorePrizeRecovery(
    giveaway: GiveawaySummary,
    file: File | undefined,
  ): Promise<void> {
    if (!file || !giveaway.prize) return;
    setRestoringPrize(true);
    setError(null);
    try {
      const bundle = parseGiveawayPrizeRecoveryBundle(await file.text());
      const prize = bundle.prize;
      if (
        prize.linkKey !== giveaway.prize.linkKey ||
        prize.fundingAddress !== giveaway.prize.fundingAddress ||
        prize.claimPublicKey.toLowerCase() !== giveaway.prize.claimPublicKey.toLowerCase() ||
        prize.refundPublicKey.toLowerCase() !== giveaway.prize.refundPublicKey.toLowerCase()
      ) {
        throw new Error("This recovery file belongs to a different giveaway prize.");
      }
      const restoredRecords = await saveClaimableRecord({
        ...prizeRecoveryToLocalRecord(prize),
        recoveryExportedAt: bundle.exportedAt,
      });
      setPrizeRecoveryAccessByLink((current) => ({ ...current, [prize.linkKey]: true }));
      setPrizeAutoPrepareByLink((current) => ({
        ...current,
        [prize.linkKey]:
          restoredRecords.find((record) => record.id === prize.linkKey)
            ?.giveawayAutoPrepareEnabled === true ||
          restoredRecords.find((record) => record.id === prize.linkKey)
            ?.giveawayAutoPayoutEnabled === true,
      }));
      if (createdGiveaway?.publicId === giveaway.publicId) {
        setCreatedEscrow(prize);
        setPrizeRecoveryReady(true);
        setPrizeRecoverySkipped(false);
      }
      setNotice("Recovery file restored.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prize recovery could not be restored.");
    } finally {
      setRestoringPrize(false);
    }
  }

  async function setPrizeAutoPreparePreference(
    giveaway: GiveawaySummary,
    enabled: boolean,
  ): Promise<void> {
    if (!giveaway.prize) return;
    setError(null);
    try {
      const records = await loadClaimableRecords();
      const local = records.find((record) => record.id === giveaway.prize!.linkKey);
      if (!local?.claimCode) {
        throw new Error(
          "Restore the private prize recovery bundle before enabling automatic claim preparation.",
        );
      }
      await saveClaimableRecord({
        ...local,
        giveawayAutoPrepareEnabled: enabled,
        giveawayAutoPayoutEnabled: false,
        giveawayPublicId: giveaway.publicId,
        updatedAtMs: Date.now(),
      });
      setPrizeAutoPrepareByLink((current) => ({
        ...current,
        [giveaway.prize!.linkKey]: enabled,
      }));
      setNotice(
        enabled
          ? "Automatic claim preparation enabled. Keep this browser available or return after the draw."
          : "Automatic claim preparation disabled.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Claim preparation preference could not be saved.",
      );
    }
  }

  const prepareWinnerClaim = useCallback(
    async (giveaway: GiveawaySummary, options: { automatic?: boolean } = {}) => {
      if (!giveaway.winnerAddress || !giveaway.prize) return;
      const prize = giveaway.prize;
      if (!prize.fundingTxId || prize.fundingOutputIndex === null) {
        setError("The parked prize funding output has not been confirmed yet.");
        return;
      }

      setPayingId(giveaway.publicId);
      setError(null);
      setNotice(null);
      try {
        const records = await loadClaimableRecords();
        const local = records.find((record) => record.id === prize.linkKey);
        if (!local?.claimCode) {
          throw new Error(
            "This browser does not have the private prize key. Restore the private prize recovery bundle first.",
          );
        }

        await preloadClaimableBrowserSigner();
        const spend = await buildClaimableSpendInBrowser({
          destinationAddress: giveaway.winnerAddress,
          expectedFundingAddress: prize.fundingAddress,
          feeSompi: prize.feeSompi,
          fundingAmountSompi: prize.amountSompi,
          fundingOutputIndex: prize.fundingOutputIndex,
          fundingTransactionId: prize.fundingTxId,
          mode: "claim",
          privateKey: local.claimCode,
          redeemScriptHex: prize.redeemScriptHex,
        });
        const response = await fetch(
          `/api/toccata-lab/giveaways/${giveaway.publicId}/prepare-claim`,
          {
            body: JSON.stringify({
              expectedTransactionId: spend.transactionId,
              linkKey: prize.linkKey,
              transactionSafeJson: spend.transactionSafeJson,
            }),
            headers: creatorHeaders ?? { "Content-Type": "application/json" },
            method: "POST",
          },
        );
        const body = (await response.json()) as {
          prepared?: { expiresAt: string; preparedAt: string; transactionId: string };
          error?: { message?: string };
        };
        if (!response.ok || !body.prepared?.transactionId) {
          throw new Error(body.error?.message ?? "The winner claim could not be prepared.");
        }

        setGiveaways((current) =>
          current.map((item) =>
            item.publicId === giveaway.publicId
              ? {
                  ...item,
                  winnerClaim: {
                    ...item.winnerClaim,
                    expiresAt: body.prepared!.expiresAt,
                    preparedAt: body.prepared!.preparedAt,
                    preparedTransactionId: body.prepared!.transactionId,
                  },
                }
              : item,
          ),
        );
        setPrizeAutoPrepareByLink((current) => ({ ...current, [prize.linkKey]: false }));
        setNotice(
          options.automatic
            ? "Winner claim prepared automatically. The winner can now release the fixed payout."
            : "Winner claim prepared. The payout can only go to the selected address.",
        );
        try {
          const records = await loadClaimableRecords();
          const local = records.find((record) => record.id === prize.linkKey);
          if (local) {
            await saveClaimableRecord({
              ...local,
              giveawayAutoPrepareEnabled: false,
              giveawayAutoPayoutEnabled: false,
              giveawayPublicId: giveaway.publicId,
              updatedAtMs: Date.now(),
            });
          }
        } catch {
          // The server-side prepared state is authoritative. Local preference
          // cleanup is best-effort and contains no server-side secret.
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The winner claim was not prepared.");
      } finally {
        setPayingId(null);
      }
    },
    [creatorHeaders],
  );

  useEffect(() => {
    const findCandidate = () =>
      giveaways.find((giveaway) => {
        const prize = giveaway.prize;
        if (!prize) return false;
        return (
          prizeAutoPrepareByLink[prize.linkKey] === true &&
          shouldPrepareGiveawayClaim({
            claimTxId: payoutTxById[giveaway.publicId] ?? prize.claimTxId,
            fundingOutputIndex: prize.fundingOutputIndex,
            fundingTxId: prize.fundingTxId,
            preparedTransactionId: giveaway.winnerClaim.preparedTransactionId,
            prizeStatus: prize.status,
            status: giveaway.status,
            winnerAddress: giveaway.winnerAddress,
          })
        );
      });

    const attemptPayout = () => {
      if (payingId) return;
      const candidate = findCandidate();
      if (!candidate || autoPrepareInFlightRef.current.has(candidate.publicId)) return;
      const lastAttempt = autoPrepareLastAttemptRef.current.get(candidate.publicId) ?? 0;
      if (Date.now() - lastAttempt < 30_000) return;

      autoPrepareLastAttemptRef.current.set(candidate.publicId, Date.now());
      autoPrepareInFlightRef.current.add(candidate.publicId);
      void prepareWinnerClaim(candidate, { automatic: true }).finally(() => {
        autoPrepareInFlightRef.current.delete(candidate.publicId);
      });
    };

    if (!findCandidate()) return;
    attemptPayout();
    const timer = window.setInterval(attemptPayout, 30_000);
    return () => window.clearInterval(timer);
  }, [giveaways, payingId, payoutTxById, prepareWinnerClaim, prizeAutoPrepareByLink]);

  async function openPrizeRefund(giveaway: GiveawaySummary): Promise<void> {
    if (!giveaway.prize?.fundingTxId || giveaway.prize.fundingOutputIndex === null) {
      setError("The parked prize funding output is not available.");
      return;
    }
    setError(null);
    try {
      const local = (await loadClaimableRecords()).find(
        (record) => record.id === giveaway.prize!.linkKey,
      );
      if (!local?.refundCode) {
        throw new Error(
          "This browser does not have the private refund key. Restore the private prize recovery bundle first.",
        );
      }
      const prize = giveaway.prize;
      window.location.assign(
        buildClaimableManageUrl(window.location.origin, {
          amountKas: sompiToKas(prize.amountSompi),
          amountSompi: prize.amountSompi,
          createdAt: local.createdAt,
          createdAtMs: local.createdAtMs,
          description: local.description,
          feeKas: sompiToKas(prize.feeSompi),
          feeSompi: prize.feeSompi,
          fundingAddress: prize.fundingAddress,
          fundingMatch: {
            amountSompi: prize.amountSompi,
            blockTime: null,
            outputIndex: prize.fundingOutputIndex,
            transactionId: prize.fundingTxId,
          },
          id: prize.linkKey,
          netClaimKas: giveaway.amountKas,
          redeemScriptHex: prize.redeemScriptHex,
          refundCode: local.refundCode,
          refundLockTime: prize.refundLockTime,
          refundPublicKey: prize.refundPublicKey,
          title: giveaway.title,
          validFor: "Giveaway entry window plus refund safety margin",
          version: 1,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Prize refund could not be opened.");
    }
  }

  // The kaspa: deep link only resolves where a wallet registered the scheme —
  // fine on phones, a dead click on desktop. KasWare is the desktop path.
  async function payWinnerWithKasware(giveaway: GiveawaySummary) {
    if (!giveaway.winnerAddress) return;
    setPayingId(giveaway.publicId);
    setError(null);
    setNotice(null);
    try {
      const provider = getKaswareProvider();
      if (!provider) {
        throw new Error(
          "KasWare was not detected. Install or unlock the extension, or use the QR code from a phone wallet.",
        );
      }
      await connectKaswareWallet(provider);
      const result = await sendKaspaPayment(provider, {
        amountSompi: kaspaAmountToSompi(giveaway.amountKas),
        toAddress: giveaway.winnerAddress,
      });
      if (result.txId) {
        setPayoutTxById((current) => ({ ...current, [giveaway.publicId]: result.txId! }));
      }
      setNotice(
        `Payout sent to the winner${result.txId ? "" : " — check your wallet for the id"}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payout was not sent.");
    } finally {
      setPayingId(null);
    }
  }

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setError("Clipboard access failed. Select and copy the value manually.");
    }
  }

  async function showPayoutQr(giveaway: GiveawaySummary) {
    if (!giveaway.winnerAddress) return;
    try {
      const QRCode = await import("qrcode");
      const uri = buildWalletLaunchUri({
        amountKas: giveaway.amountKas,
        recipientAddress: giveaway.winnerAddress,
      });
      const dataUrl = await QRCode.toDataURL(uri, {
        color: { dark: "#0b1116", light: "#ffffff" },
        errorCorrectionLevel: "M",
        margin: 2,
        width: 420,
      });
      setQrById((current) => ({ ...current, [giveaway.publicId]: dataUrl }));
    } catch {
      setError("Payout QR code could not be generated.");
    }
  }

  if (!enabled) {
    return (
      <main className="main giveaway-lab-page">
        <section className="card">
          <h1>Giveaway Lab is disabled</h1>
          <p className="muted">This private experiment is not enabled on this deployment.</p>
        </section>
      </main>
    );
  }

  if (!sessionReady)
    return (
      <main className="main giveaway-lab-page">
        <p>Loading…</p>
      </main>
    );

  const createdGiveawayState = createdGiveaway
    ? (giveaways.find((giveaway) => giveaway.publicId === createdGiveaway.publicId) ??
      createdGiveaway)
    : null;
  const prizeFundingUnlocked = prizeRecoveryReady || prizeRecoverySkipped;
  const fundingDeadline = createdGiveawayState ? giveawayFundingDeadline(createdGiveawayState) : 0;
  const createdFundingExpired =
    now >= fundingDeadline ||
    !Number.isFinite(fundingDeadline) ||
    ["claimed", "refunded", "spent_unknown"].includes(createdGiveawayState?.prize?.status ?? "");
  const fundingTimeRemaining = `${Math.min(60, Math.max(1, Math.ceil((fundingDeadline - now) / 60000)))} min`;
  const durationForCreated = formatDuration(
    createdGiveawayState?.entryWindowSeconds ??
      Number(durationValue) *
        (durationUnit === "days" ? 86400 : durationUnit === "hours" ? 3600 : 60),
  ).replace("after draw", "after funding");
  const createdEscrowFundingUri = createdEscrow
    ? buildWalletLaunchUri({
        amountKas: createdEscrow.amountKas,
        recipientAddress: createdEscrow.fundingAddress,
      })
    : null;

  return (
    <main className="main-wide giveaway-lab-page giveaway-guided-page">
      <header className="giveaway-setup-header">
        <div>
          <span className="label">Kaspa giveaways</span>
          <h1 ref={setupHeading} tabIndex={-1}>
            {stage === "manage" ? "Your giveaways" : "Create a giveaway"}
          </h1>
        </div>
        {session && stage !== "manage" ? (
          <button type="button" className="btn" onClick={showManage} disabled={submitting}>
            Your giveaways
          </button>
        ) : null}
        {stage === "manage" ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setCreatedGiveaway(null);
              setCreatedEscrow(null);
              setStage("details");
              setError(null);
              setNotice(null);
            }}
          >
            New giveaway
          </button>
        ) : null}
      </header>
      {stage !== "manage" ? (
        <ol className="giveaway-stepper" aria-label="Giveaway setup progress">
          {["Details", "Secure", "Fund", "Share"].map((label, index) => {
            const current =
              stage === "details" ? 0 : stage === "access" ? 1 : stage === "fund" ? 2 : 3;
            return (
              <li
                key={label}
                aria-current={current === index ? "step" : undefined}
                className={index < current ? "is-complete" : ""}
              >
                <span aria-hidden="true">{index < current ? "✓" : index + 1}</span>
                {label}
              </li>
            );
          })}
        </ol>
      ) : null}
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <p className="giveaway-setup-notice" role="status">
          {notice}
        </p>
      ) : null}

      {stage === "details" ? (
        <section className="card giveaway-setup-card">
          <h2>Make it yours</h2>
          <form
            className="giveaway-form"
            onSubmit={continueSetup}
            onChange={() => {
              restoredSettingsRef.current = true;
            }}
          >
            <label className="field">
              <span className="label">Title</span>
              <input
                maxLength={80}
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="label">Winner receives (KAS)</span>
              <input
                inputMode="decimal"
                required
                value={amountKas}
                onChange={(event) => setAmountKas(event.target.value.replace(",", "."))}
              />
            </label>
            <fieldset className="giveaway-duration-presets">
              <legend className="label">Entries stay open for</legend>
              <div className="row">
                {[
                  { label: "1 hour", value: "1", unit: "hours" },
                  { label: "24 hours", value: "24", unit: "hours" },
                  { label: "7 days", value: "7", unit: "days" },
                ].map((option) => (
                  <button
                    type="button"
                    className="btn"
                    key={option.label}
                    aria-pressed={durationValue === option.value && durationUnit === option.unit}
                    onClick={() => {
                      setDurationValue(option.value);
                      setDurationUnit(option.unit as "hours" | "days");
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <details className="giveaway-setup-details">
              <summary>
                Custom duration · {durationValue} {durationUnit}
              </summary>
              <div className="giveaway-duration-control">
                <input
                  aria-label="Entry duration"
                  inputMode="numeric"
                  value={durationValue}
                  onChange={(event) => setDurationValue(event.target.value)}
                />
                <select
                  aria-label="Entry duration unit"
                  value={durationUnit}
                  onChange={(event) => setDurationUnit(event.target.value as typeof durationUnit)}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            </details>
            <details className="giveaway-setup-details">
              <summary>Add a description</summary>
              <label className="field">
                <span className="label">Description (optional)</span>
                <textarea
                  maxLength={280}
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </details>
            <details className="giveaway-setup-details">
              <summary>More settings</summary>
              <label className="field">
                <span className="label">Winner claim window</span>
                <div className="giveaway-duration-control">
                  <input
                    aria-label="Winner claim duration"
                    inputMode="numeric"
                    value={winnerClaimValue}
                    onChange={(event) => setWinnerClaimValue(event.target.value)}
                  />
                  <select
                    aria-label="Winner claim duration unit"
                    value={winnerClaimUnit}
                    onChange={(event) =>
                      setWinnerClaimUnit(event.target.value as typeof winnerClaimUnit)
                    }
                  >
                    <option value="minutes">Minutes</option>
                    <option value="hours">Hours</option>
                    <option value="days">Days</option>
                  </select>
                </div>
              </label>
              <label className="giveaway-check">
                <input
                  type="checkbox"
                  checked={escrowPrize}
                  onChange={(event) => setEscrowPrize(event.target.checked)}
                />
                <span>Fund the prize before entries open</span>
              </label>
              {!escrowPrize ? (
                <p className="muted">You will pay the selected winner manually from your wallet.</p>
              ) : null}
              {escrowPrize ? (
                <label className="giveaway-check">
                  <input
                    type="checkbox"
                    checked={autoPrepareClaim}
                    onChange={(event) => setAutoPrepareClaim(event.target.checked)}
                  />
                  <span>
                    Automatically prepare the winner payout when this browser is open after the draw
                  </span>
                </label>
              ) : null}
            </details>
            <div className="giveaway-step-actions">
              <button type="submit" className="btn btn-primary btn-block">
                Continue
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {stage === "access" ? (
        <section className="card giveaway-setup-card">
          {!session ? (
            <>
              <div className="giveaway-auth-tabs" aria-label="Choose account access">
                <button
                  type="button"
                  className="btn"
                  aria-pressed={authMode === "signup"}
                  onClick={() => setAuthMode("signup")}
                >
                  New profile
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-pressed={authMode === "signin"}
                  onClick={() => setAuthMode("signin")}
                >
                  Sign in
                </button>
              </div>
              {authMode === "signup" ? (
                <CreateProfileClient onContinue={acceptIdentity} />
              ) : (
                <SignInClient onSignedIn={acceptIdentity} />
              )}
              <button type="button" className="btn" onClick={() => setStage("details")}>
                Back to details
              </button>
            </>
          ) : !createdGiveawayState ? (
            <>
              <h2>{escrowPrize ? "Secure your prize" : "Review your giveaway"}</h2>
              <p className="muted">
                {title} · {amountKas} KAS · {durationValue} {durationUnit}
              </p>
              <p>
                {escrowPrize
                  ? "Next, save a private recovery file. You need it to pay or recover the prize from another device."
                  : "Entries open immediately. You pay the selected winner from your wallet after the draw."}
              </p>
              {escrowPrize ? (
                <p className="muted">
                  {autoPrepareClaim
                    ? "After the draw, reopen this browser to prepare the winner payout automatically."
                    : "After the draw, return here to prepare the winner payout."}
                </p>
              ) : null}
              <div className="giveaway-step-actions">
                <button
                  className="btn btn-primary btn-block"
                  type="button"
                  disabled={submitting}
                  onClick={() => void createGiveaway()}
                >
                  {submitting
                    ? "Preparing…"
                    : escrowPrize
                      ? "Prepare recovery file"
                      : "Create giveaway"}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={submitting}
                  onClick={() => setStage("details")}
                >
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>{createdEscrow ? "Save your recovery file" : "Restore your recovery file"}</h2>
              <p>
                Keep this file private. Without it, losing this browser’s data can make the prize
                unrecoverable.
              </p>
              {session.kind === "telegram" ? (
                <p className="muted">
                  Choose “Save to Files” in the device menu. Never send it in a chat.
                </p>
              ) : null}
              {createdEscrow ? (
                <button
                  className={`btn ${prizeFundingUnlocked ? "" : "btn-primary btn-block"}`}
                  type="button"
                  onClick={() => void downloadPrizeRecovery()}
                >
                  {prizeRecoveryReady ? "Save file again" : "Save recovery file"}
                </button>
              ) : (
                <label className="btn btn-primary giveaway-file-button">
                  {restoringPrize ? "Restoring…" : "Choose recovery file"}
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={restoringPrize}
                    onChange={(event) =>
                      void restorePrizeRecovery(createdGiveawayState, event.target.files?.[0])
                    }
                  />
                </label>
              )}
              {createdEscrow && !prizeRecoveryReady ? (
                <details className="giveaway-setup-details">
                  <summary>Continue without a backup</summary>
                  <label className="giveaway-check">
                    <input
                      type="checkbox"
                      checked={prizeRecoverySkipped}
                      onChange={(event) => void markPrizeRecoveryRiskAccepted(event.target.checked)}
                    />
                    <span>
                      I accept that losing this browser’s data may permanently lose access to the
                      prize.
                    </span>
                  </label>
                </details>
              ) : null}
              {prizeFundingUnlocked ? (
                <div className="giveaway-step-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={() => {
                      setNotice(null);
                      setStage("fund");
                    }}
                  >
                    Continue to funding
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {stage === "fund" && createdGiveawayState ? (
        <section className="card giveaway-setup-card">
          <h2>{createdFundingExpired ? "Funding unavailable" : "Fund your giveaway"}</h2>
          {createdFundingExpired ? (
            <>
              <p>
                Do not send new funds. If you already paid, check the giveaway status and recovery
                options.
              </p>
              <button type="button" className="btn btn-primary" onClick={showManage}>
                View giveaway
              </button>
            </>
          ) : createdEscrow && prizeFundingUnlocked ? (
            <>
              <p className="muted">{createdGiveawayState.title}</p>
              <dl className="giveaway-funding-summary">
                <div>
                  <dt>Winner receives</dt>
                  <dd>{createdEscrow.netClaimKas} KAS</dd>
                </div>
                <div>
                  <dt>Reserved claim fee</dt>
                  <dd>{createdEscrow.feeKas} KAS</dd>
                </div>
                <div className="giveaway-funding-total">
                  <dt>Send exactly</dt>
                  <dd>{createdEscrow.amountKas} KAS</dd>
                </div>
                <div>
                  <dt>Entry window</dt>
                  <dd>{durationForCreated}</dd>
                </div>
                <div>
                  <dt>Winner claim window</dt>
                  <dd>{formatDuration(createdGiveawayState.winnerClaim.windowSeconds)}</dd>
                </div>
              </dl>
              <label className="label">Recipient</label>
              <code className="giveaway-dialog-url">{createdEscrow.fundingAddress}</code>
              <p className="muted">
                Your wallet shows its sending fee before you confirm. Entries open once funding is
                confirmed.
              </p>
              <div className="giveaway-step-actions">
                <a
                  className="btn btn-primary btn-block"
                  href={createdEscrowFundingUri ?? undefined}
                >
                  Open wallet
                </a>
              </div>
              <details className="giveaway-setup-details">
                <summary>Use a QR code or copy the address</summary>
                {createdEscrowFundingUri ? (
                  <FundingQrCode
                    ariaLabel={`Fund ${createdEscrow.amountKas} KAS`}
                    paymentUri={createdEscrowFundingUri}
                  />
                ) : null}
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    void copyText(createdEscrow.fundingAddress, "Funding address copied.")
                  }
                >
                  Copy address
                </button>
              </details>
              <p className="giveaway-funding-wait" role="status">
                Waiting for payment confirmation…
              </p>
              <p className="muted">
                Fund within {fundingTimeRemaining}. You can return here after opening your wallet.
              </p>
              <button className="btn" type="button" onClick={() => setStage("access")}>
                Back to recovery
              </button>
            </>
          ) : (
            <>
              <p>Restore your recovery file before funding.</p>
              <button className="btn btn-primary" type="button" onClick={() => setStage("access")}>
                Restore recovery
              </button>
            </>
          )}
        </section>
      ) : null}

      {stage === "share" && createdGiveawayState ? (
        <section className="card giveaway-setup-card giveaway-ready-card">
          <span className="giveaway-ready-check" aria-hidden="true">
            ✓
          </span>
          <h2>Your giveaway is live</h2>
          <p>
            {createdGiveawayState.title} · {createdGiveawayState.amountKas} KAS
          </p>
          <p className="muted">{formatDeadline(createdGiveawayState.closesAt, now)} to enter.</p>
          <TelegramGiveawayActions
            publicId={createdGiveawayState.publicId}
            botUsername={botUsername}
            primary
          />
          <Link className="btn" href={createdGiveawayState.publicUrl} target="_blank">
            View giveaway
          </Link>
          <button className="btn" type="button" onClick={showManage}>
            Manage giveaway
          </button>
        </section>
      ) : null}

      {stage === "details" ? (
        <details className="giveaway-setup-details giveaway-help">
          <summary>How does it work?</summary>
          <p>The prize stays on Kaspa. Wallet signing and private recovery stay on your device.</p>
          <p>
            After entries close, a future Kaspa block determines the winner from the frozen
            participant list. The public result includes the proof.
          </p>
          <p>One entry per address does not guarantee one entry per person.</p>
        </details>
      ) : null}

      {deleteCandidate ? (
        <div
          aria-labelledby="giveaway-delete-title"
          aria-modal="true"
          className="giveaway-dialog-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && deletingId === null) {
              setDeleteCandidate(null);
            }
          }}
          role="dialog"
        >
          <div className="card giveaway-dialog giveaway-delete-dialog">
            <span className="label">Delete giveaway</span>
            <h2 id="giveaway-delete-title">Delete “{deleteCandidate.title}”?</h2>
            <p className="muted">
              The public giveaway page and its participant list will be removed. This does not move
              funds, sign a transaction, or delete the preserved on-chain prize record.
            </p>
            <div className="row giveaway-delete-actions">
              <button
                className="btn"
                disabled={deletingId !== null}
                onClick={() => setDeleteCandidate(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={deletingId !== null}
                onClick={() => void deleteGiveaway(deleteCandidate)}
                type="button"
              >
                {deletingId === deleteCandidate.publicId ? "Deleting…" : "Delete giveaway"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {stage === "manage" ? (
        <section className="giveaway-list-section">
          <div className="section-heading">
            <div>
              <span className="label">Manage</span>
              <h2>Overview</h2>
            </div>
            <button
              className="btn"
              disabled={loading}
              onClick={() => void loadGiveaways()}
              type="button"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {giveaways.length === 0 && !loading ? (
            <div className="empty-state">
              <p>Your giveaways will appear here.</p>
            </div>
          ) : null}
          <div className="giveaway-list">
            {giveaways.map((giveaway) => {
              const effectiveStatus =
                giveaway.status === "OPEN" && new Date(giveaway.closesAt).getTime() <= now
                  ? "CLOSED"
                  : giveaway.status;
              const publicUrl =
                typeof window === "undefined"
                  ? giveaway.publicUrl
                  : new URL(giveaway.publicUrl, window.location.origin).toString();
              const payoutUri = giveaway.winnerAddress
                ? buildWalletLaunchUri({
                    amountKas: giveaway.amountKas,
                    recipientAddress: giveaway.winnerAddress,
                  })
                : null;
              const payoutQr = qrById[giveaway.publicId];
              const payoutTxId =
                payoutTxById[giveaway.publicId] ?? giveaway.prize?.claimTxId ?? null;
              const prizeFundingUnlockedForLink = giveaway.prize
                ? Boolean(prizeRecoveryAccessByLink[giveaway.prize.linkKey])
                : false;
              const prizeFundingWindowExpired =
                effectiveStatus === "PENDING_FUNDING" &&
                (giveawayFundingDeadline(giveaway) <= now ||
                  ["claimed", "refunded", "spent_unknown"].includes(giveaway.prize?.status ?? ""));
              const progress = giveawayProgress(giveaway, now);
              return (
                <article className="card giveaway-manage-card" key={giveaway.publicId}>
                  <div className="giveaway-card-head">
                    <div>
                      <span className={`status-chip status-${effectiveStatus.toLowerCase()}`}>
                        {progress.label}
                      </span>
                      <h3>{giveaway.title}</h3>
                    </div>
                    <strong className="giveaway-amount">{giveaway.amountKas} KAS</strong>
                  </div>
                  <p>{progress.hint}</p>
                  <p className="muted">
                    {giveaway.entryCount} entries · {giveaway.amountKas} KAS
                  </p>
                  {progress.step === "fund" ? (
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => void resumeSetup(giveaway)}
                    >
                      Continue setup
                    </button>
                  ) : progress.step === "open" ? (
                    <TelegramGiveawayActions
                      publicId={giveaway.publicId}
                      botUsername={botUsername}
                      primary
                    />
                  ) : progress.step === "draw" ? (
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={drawingId === giveaway.publicId}
                      onClick={() => void drawWinner(giveaway.publicId)}
                    >
                      {drawingId === giveaway.publicId ? "Checking draw…" : "Check draw result"}
                    </button>
                  ) : ["payout", "refund", "attention"].includes(progress.step) ? (
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => setExpandedId(giveaway.publicId)}
                    >
                      {progress.step === "payout"
                        ? "Review winner payout"
                        : progress.step === "refund"
                          ? "Review refund"
                          : "Check prize details"}
                    </button>
                  ) : (
                    <Link className="btn btn-primary" href={giveaway.publicUrl} target="_blank">
                      View result
                    </Link>
                  )}
                  <details
                    className="giveaway-manage-details"
                    open={expandedId === giveaway.publicId}
                    onToggle={(event) => {
                      const open = event.currentTarget.open;
                      setExpandedId((current) =>
                        open ? giveaway.publicId : current === giveaway.publicId ? null : current,
                      );
                    }}
                  >
                    <summary>Manage, recovery and proof</summary>
                    {giveaway.description ? <p className="muted">{giveaway.description}</p> : null}
                    {giveaway.prize ? (
                      <p
                        className={`giveaway-prize-state${giveaway.prize.funded ? " is-funded" : ""}`}
                      >
                        {giveaway.prize.status === "spent_unknown"
                          ? "Unrecognized prize spend — verify the transaction"
                          : giveaway.prize.status === "claimed"
                            ? "Prize paid out from escrow"
                            : giveaway.prize.status === "refunded"
                              ? "Prize pulled back"
                              : giveaway.prize.funded
                                ? "Prize parked on-chain · entrants can verify it"
                                : "Waiting for your funding payment — entrants see no prize yet"}
                      </p>
                    ) : null}
                    {giveaway.prize &&
                    !giveaway.winnerClaim.preparedTransactionId &&
                    !["refunded", "spent_unknown"].includes(giveaway.prize.status) ? (
                      <label className="giveaway-auto-payout-toggle giveaway-card-auto-payout">
                        <input
                          checked={prizeAutoPrepareByLink[giveaway.prize.linkKey] === true}
                          onChange={(event) =>
                            void setPrizeAutoPreparePreference(giveaway, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>
                          <strong>Automatic preparation on this device</strong>
                          <span className="muted">
                            {prizeAutoPrepareByLink[giveaway.prize.linkKey] === true
                              ? "Enabled in this browser. Keep it available after the draw."
                              : "Off in this browser. Another device may still have it enabled."}
                          </span>
                        </span>
                      </label>
                    ) : null}
                    <div className="giveaway-metrics">
                      <div>
                        <span>Entries</span>
                        <strong>{giveaway.entryCount}</strong>
                      </div>
                      <div>
                        <span>Closes</span>
                        <strong>
                          {effectiveStatus === "PENDING_FUNDING"
                            ? "Starts after funding"
                            : formatDeadline(giveaway.closesAt, now)}
                        </strong>
                      </div>
                      <div>
                        <span>Winner claim</span>
                        <strong>
                          {giveaway.winnerClaim.expiresAt
                            ? formatDeadline(giveaway.winnerClaim.expiresAt, now)
                            : formatDuration(giveaway.winnerClaim.windowSeconds)}
                        </strong>
                      </div>
                      <div title="Published before entries close. After the draw, the seed must match this value — that is how entrants verify nothing was swapped.">
                        <span>Commitment</span>
                        <code>{compactHash(giveaway.drawCommitment)}</code>
                      </div>
                    </div>
                    {giveaway.drawProtocol.version >= 2 && giveaway.drawProtocol.entriesRoot ? (
                      <div className="giveaway-verifiable-state">
                        <span className="label">
                          {giveaway.drawProtocol.entropyBlockHash
                            ? "Future-chain proof complete"
                            : "Participant list frozen"}
                        </span>
                        <p>
                          {giveaway.drawProtocol.entropyBlockHash
                            ? "The selected Kaspa chain block and final draw proof are now public."
                            : `Waiting for a confirmed Kaspa chain block at or after blue score ${giveaway.drawProtocol.entropyTargetBlueScore}.`}
                        </p>
                        <code>{giveaway.drawProtocol.entriesRoot}</code>
                      </div>
                    ) : null}
                    {effectiveStatus === "PENDING_FUNDING" && giveaway.prize ? (
                      <div className="giveaway-escrow-panel giveaway-funding-panel">
                        <span className="label">Prize funding required</span>
                        <p>
                          {prizeFundingWindowExpired ? (
                            <>
                              Funding is unavailable. Do not send new funds to this address. If a
                              late payment arrived, use the private recovery file to refund it.
                            </>
                          ) : (
                            <>
                              Save the private recovery file, then send exactly{" "}
                              <strong>{sompiToKas(giveaway.prize.amountSompi)} KAS</strong> to the
                              one-time address within 1 hour. Entries open automatically after
                              confirmation.
                            </>
                          )}
                        </p>
                        <code className="giveaway-dialog-url">{giveaway.prize.fundingAddress}</code>
                        <div className="row">
                          <button
                            className="btn"
                            onClick={() => void downloadExistingPrizeRecovery(giveaway)}
                            type="button"
                          >
                            Download recovery bundle
                          </button>
                          <label className="btn giveaway-file-button">
                            {restoringPrize ? "Restoring…" : "Restore recovery bundle"}
                            <input
                              accept="application/json,.json"
                              disabled={restoringPrize}
                              onChange={(event) =>
                                void restorePrizeRecovery(giveaway, event.target.files?.[0])
                              }
                              type="file"
                            />
                          </label>
                        </div>
                        <div className="row">
                          <button
                            className="btn"
                            disabled={!prizeFundingUnlockedForLink || prizeFundingWindowExpired}
                            onClick={() =>
                              void copyText(
                                giveaway.prize!.fundingAddress,
                                "Funding address copied.",
                              )
                            }
                            type="button"
                          >
                            Copy funding address
                          </button>
                          <a
                            aria-disabled={
                              !prizeFundingUnlockedForLink || prizeFundingWindowExpired
                            }
                            className={`btn btn-primary${
                              prizeFundingUnlockedForLink && !prizeFundingWindowExpired
                                ? ""
                                : " is-disabled"
                            }`}
                            href={
                              prizeFundingUnlockedForLink && !prizeFundingWindowExpired
                                ? buildWalletLaunchUri({
                                    amountKas: sompiToKas(giveaway.prize.amountSompi),
                                    recipientAddress: giveaway.prize.fundingAddress,
                                  })
                                : undefined
                            }
                            onClick={(event) => {
                              if (!prizeFundingUnlockedForLink || prizeFundingWindowExpired) {
                                event.preventDefault();
                                setError(
                                  prizeFundingWindowExpired
                                    ? "The prize funding window has closed. Do not send new funds."
                                    : "Download or restore the private recovery bundle before funding.",
                                );
                              }
                            }}
                          >
                            Open funding in wallet
                          </a>
                          {prizeFundingWindowExpired && giveaway.prize.fundingTxId ? (
                            <button
                              className="btn btn-primary"
                              onClick={() => void openPrizeRefund(giveaway)}
                              type="button"
                            >
                              Open late-funding refund
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    <div className="row giveaway-actions">
                      {effectiveStatus !== "PENDING_FUNDING" ? (
                        <>
                          <Link className="btn" href={giveaway.publicUrl} target="_blank">
                            Open entry page
                          </Link>
                          <button
                            className="btn"
                            onClick={() => void copyText(publicUrl, "Entry link copied.")}
                            type="button"
                          >
                            Copy entry link
                          </button>
                          <TelegramGiveawayActions
                            publicId={giveaway.publicId}
                            botUsername={botUsername}
                          />
                        </>
                      ) : null}
                      {effectiveStatus === "CLOSED" ? (
                        <button
                          className="btn btn-primary"
                          disabled={drawingId === giveaway.publicId}
                          onClick={() => void drawWinner(giveaway.publicId)}
                          type="button"
                        >
                          {drawingId === giveaway.publicId ? "Drawing…" : "Draw winner"}
                        </button>
                      ) : null}
                    </div>

                    {effectiveStatus === "DRAWN" &&
                    giveaway.winnerAddress &&
                    payoutUri &&
                    !["refunded", "spent_unknown"].includes(giveaway.prize?.status ?? "") ? (
                      <div className="giveaway-winner-panel">
                        <span className="label">Winner</span>
                        <h4>{compactAddress(giveaway.winnerAddress)}</h4>
                        <code>{giveaway.winnerAddress}</code>
                        <p>
                          {giveaway.prize
                            ? giveaway.winnerClaim.preparedTransactionId
                              ? `The ${giveaway.amountKas} KAS winner claim is ready and cannot be redirected to another address.`
                              : `Prepare the ${giveaway.amountKas} KAS winner claim. Signing happens in this browser and fixes the selected address.`
                            : `Send exactly ${giveaway.amountKas} KAS. The wallet remains the final confirmation step.`}
                        </p>
                        <div className="row">
                          {giveaway.prize ? (
                            <button
                              className="btn btn-primary"
                              disabled={
                                payingId === giveaway.publicId ||
                                Boolean(payoutTxId) ||
                                Boolean(giveaway.winnerClaim.preparedTransactionId) ||
                                Boolean(
                                  giveaway.winnerClaim.expiresAt &&
                                  new Date(giveaway.winnerClaim.expiresAt).getTime() <= now,
                                )
                              }
                              onClick={() => void prepareWinnerClaim(giveaway)}
                              type="button"
                            >
                              {payingId === giveaway.publicId
                                ? "Preparing winner claim…"
                                : payoutTxId
                                  ? "Prize claimed"
                                  : giveaway.winnerClaim.preparedTransactionId
                                    ? "Winner claim ready"
                                    : "Prepare winner claim"}
                            </button>
                          ) : kaswareAvailable ? (
                            <button
                              className="btn btn-primary"
                              disabled={payingId === giveaway.publicId}
                              onClick={() => void payWinnerWithKasware(giveaway)}
                              type="button"
                            >
                              {payingId === giveaway.publicId
                                ? "Waiting for KasWare…"
                                : `Pay ${giveaway.amountKas} KAS with KasWare`}
                            </button>
                          ) : (
                            <a className="btn btn-primary" href={payoutUri}>
                              Open payout in wallet
                            </a>
                          )}
                          <button
                            className="btn"
                            onClick={() =>
                              void copyText(giveaway.winnerAddress!, "Winner address copied.")
                            }
                            type="button"
                          >
                            Copy address
                          </button>
                          {!giveaway.prize ? (
                            <button
                              className="btn"
                              onClick={() => void showPayoutQr(giveaway)}
                              type="button"
                            >
                              Show payout QR
                            </button>
                          ) : null}
                          {giveaway.prize && !payoutTxId ? (
                            <label className="btn giveaway-file-button">
                              {restoringPrize ? "Restoring…" : "Restore prize recovery"}
                              <input
                                accept="application/json,.json"
                                disabled={restoringPrize}
                                onChange={(event) =>
                                  void restorePrizeRecovery(giveaway, event.target.files?.[0])
                                }
                                type="file"
                              />
                            </label>
                          ) : null}
                          <button
                            className="btn"
                            onClick={() =>
                              void copyText(
                                buildResultAnnouncement(giveaway, publicUrl),
                                "Result and proof copied — ready to post.",
                              )
                            }
                            type="button"
                          >
                            Copy result + proof
                          </button>
                          <button
                            className="btn"
                            onClick={() => shareWinnerOnX(giveaway, publicUrl)}
                            type="button"
                          >
                            Share winner on X
                          </button>
                          <button
                            className="btn"
                            onClick={() =>
                              void copyText(
                                buildWinnerTweet(giveaway, publicUrl, Date.now()),
                                "Winner announcement copied.",
                              )
                            }
                            type="button"
                          >
                            Copy announcement
                          </button>
                        </div>
                        {giveaway.prize &&
                        giveaway.winnerClaim.expiresAt &&
                        new Date(giveaway.winnerClaim.expiresAt).getTime() <= now &&
                        !payoutTxId ? (
                          <div className="row">
                            <span className="muted">
                              Winner claim expired. The private refund becomes available at the
                              contract lock time.
                            </span>
                            <button
                              className="btn"
                              onClick={() => void openPrizeRefund(giveaway)}
                              type="button"
                            >
                              Open prize refund
                            </button>
                          </div>
                        ) : null}
                        {payoutTxId ? (
                          <p className="giveaway-payout-sent">
                            Prize sent ·{" "}
                            <a
                              href={kaspaStreamTransactionUrl(payoutTxId)}
                              rel="noreferrer"
                              target="_blank"
                            >
                              View transaction
                            </a>
                          </p>
                        ) : null}
                        {payoutQr ? (
                          <Image
                            alt={`Payout QR for ${giveaway.title}`}
                            className="giveaway-payout-qr"
                            height={420}
                            src={payoutQr}
                            unoptimized
                            width={420}
                          />
                        ) : null}
                      </div>
                    ) : null}

                    {effectiveStatus === "NO_ENTRIES" || effectiveStatus === "CANCELLED" ? (
                      giveaway.prize &&
                      !["claimed", "refunded", "spent_unknown"].includes(giveaway.prize.status) ? (
                        <div className="giveaway-winner-panel">
                          <span className="label">Unclaimed prize</span>
                          <h4>No addresses were entered</h4>
                          <p>
                            Open the browser-signed refund flow. Kaspa enforces the refund lock
                            time.
                          </p>
                          <div className="row">
                            <button
                              className="btn btn-primary"
                              onClick={() => void openPrizeRefund(giveaway)}
                              type="button"
                            >
                              Open prize refund
                            </button>
                            <label className="btn giveaway-file-button">
                              {restoringPrize ? "Restoring…" : "Restore prize recovery"}
                              <input
                                accept="application/json,.json"
                                disabled={restoringPrize}
                                onChange={(event) =>
                                  void restorePrizeRecovery(giveaway, event.target.files?.[0])
                                }
                                type="file"
                              />
                            </label>
                          </div>
                        </div>
                      ) : (
                        <div className="notice">
                          No addresses were entered. Nothing needs to be paid.
                        </div>
                      )
                    ) : null}
                    {giveaway.drawProof ? (
                      <details className="giveaway-proof">
                        <summary>Draw proof</summary>
                        <dl>
                          <dt>Seed</dt>
                          <dd>
                            <code>{giveaway.drawProof.seed}</code>
                          </dd>
                          <dt>Digest</dt>
                          <dd>
                            <code>{giveaway.drawProof.digest}</code>
                          </dd>
                          <dt>Winner index</dt>
                          <dd>{giveaway.drawProof.winnerIndex ?? "—"}</dd>
                        </dl>
                      </details>
                    ) : null}
                    <div className="giveaway-delete-row">
                      {giveaway.prize &&
                      giveaway.prize.funded &&
                      !["claimed", "refunded"].includes(giveaway.prize.status) ? (
                        <p className="giveaway-delete-hint">
                          Pay the winner or refund the parked prize before deleting this giveaway.
                        </p>
                      ) : null}
                      <button
                        className="btn btn-danger"
                        disabled={
                          deletingId !== null ||
                          Boolean(
                            giveaway.prize &&
                            giveaway.prize.funded &&
                            !["claimed", "refunded"].includes(giveaway.prize.status),
                          )
                        }
                        onClick={() => setDeleteCandidate(giveaway)}
                        title={
                          giveaway.prize &&
                          giveaway.prize.funded &&
                          !["claimed", "refunded"].includes(giveaway.prize.status)
                            ? "Resolve the parked prize before deleting"
                            : undefined
                        }
                        type="button"
                      >
                        Delete giveaway
                      </button>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}

// @kaspa-actions/kaspa pulls in the WASM SDK and cannot be bundled for the
// browser, so the KAS→sompi conversion lives here. Integer-only: never let a
// float near an amount of money.
function kaspaAmountToSompi(amountKas: string): bigint {
  const trimmed = amountKas.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(trimmed)) {
    throw new Error(`Reward amount "${amountKas}" is not a valid KAS value.`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole!) * 100_000_000n + BigInt(fraction.padEnd(8, "0"));
}

function sompiToKas(amountSompi: string): string {
  if (!/^[0-9]+$/.test(amountSompi)) throw new Error("Prize amount is invalid.");
  const amount = BigInt(amountSompi);
  const whole = amount / 100_000_000n;
  const fraction = (amount % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function safeFilePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "giveaway";
}

function formatDeadline(value: string, now: number): string {
  const remaining = new Date(value).getTime() - now;
  if (remaining <= 0) {
    const elapsed = Math.abs(remaining);
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return "Closed just now";
    if (minutes < 60) return `Closed ${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `Closed ${hours}h ago`;
    return `Closed ${Math.floor(hours / 24)}d ago`;
  }
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours}h remaining`;
  return `${Math.ceil(hours / 24)}d remaining`;
}

function formatDuration(seconds: null | number): string {
  if (!seconds || seconds < 1) return "Set after draw";
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m after draw`;
  if (seconds < 86_400) return `${Math.ceil(seconds / 3_600)}h after draw`;
  return `${Math.ceil(seconds / 86_400)}d after draw`;
}

// The whole point of a committed draw is that the community can check it. Hand
// the creator one block of text that contains everything needed to do that.
function buildResultAnnouncement(giveaway: GiveawaySummary, entryUrl: string): string {
  const lines = [
    `${giveaway.title} — winner drawn`,
    `Prize: ${giveaway.amountKas} $KAS`,
    "",
    `Winner: ${giveaway.winnerAddress ?? "—"}`,
    "",
    "Verify the draw:",
    `Commitment (published before entries closed): ${giveaway.drawCommitment}`,
  ];
  if (giveaway.drawProof) {
    lines.push(`Seed: ${giveaway.drawProof.seed}`);
    if (giveaway.drawProof.digest) lines.push(`Digest: ${giveaway.drawProof.digest}`);
    if (giveaway.drawProof.entryCount !== null) {
      lines.push(`Entries: ${giveaway.drawProof.entryCount}`);
    }
    if (giveaway.drawProof.winnerIndex !== null) {
      lines.push(`Winner index: ${giveaway.drawProof.winnerIndex}`);
    }
  }
  lines.push("", entryUrl);
  return lines.join("\n");
}

// A snapshot, not a live counter — the tweet is static once posted.
function tweetClaimWindow(value: string, now: number): string {
  const totalMinutes = Math.max(0, Math.round((new Date(value).getTime() - now) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

// Celebratory winner announcement for social. Distinct from the proof block:
// this one pings the winner and drives them to claim. The address is compacted
// for readability; the full address and claim button live on the linked page,
// and the payout is cryptographically bound to the exact winner anyway.
function buildWinnerTweet(giveaway: GiveawaySummary, entryUrl: string, now: number): string {
  const winner = giveaway.winnerAddress ? compactAddress(giveaway.winnerAddress) : "The winner";
  // Titles can be up to 80 chars; cap so the whole tweet stays under 280 even
  // with the longest claim line and the URL (which X counts as 23).
  const title = giveaway.title.length > 50 ? `${giveaway.title.slice(0, 49)}…` : giveaway.title;
  const expiresAt = giveaway.winnerClaim.expiresAt;

  let claimLine: string;
  let cta: string;
  if (giveaway.prize && expiresAt && new Date(expiresAt).getTime() > now) {
    claimLine = `Claim it within ${tweetClaimWindow(expiresAt, now)} — the payout is locked on-chain to the winning address.`;
    cta = "Verify the draw & claim 👉";
  } else if (giveaway.prize) {
    claimLine = "The prize is escrowed on-chain and ready to claim.";
    cta = "Verify the draw & claim 👉";
  } else {
    claimLine = "Prize on its way from the creator's wallet — wallet-to-wallet, non-custodial.";
    cta = "See the result 👉";
  }

  return [
    "🎉 We have a winner!",
    "",
    `${winner} won ${giveaway.amountKas} $KAS in "${title}".`,
    "",
    claimLine,
    "",
    `${cta} ${entryUrl}`,
    "",
    "#Kaspa",
  ].join("\n");
}

function shareWinnerOnX(giveaway: GiveawaySummary, entryUrl: string): void {
  const text = buildWinnerTweet(giveaway, entryUrl, Date.now());
  window.open(
    `https://x.com/intent/post?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

function compactAddress(value: string): string {
  return value.length <= 28 ? value : `${value.slice(0, 14)}…${value.slice(-10)}`;
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
