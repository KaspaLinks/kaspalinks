"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";
import { buildBatchRecoveryPath } from "@/lib/batch-claimable-recovery";
import { buildClaimableRecoveryPath } from "@/lib/claimable-recovery";
import { writeClipboardText } from "@/lib/clipboard";
import {
  buildCompactClaimUrl,
  buildClaimableManageUrl,
  buildClaimableXPostText,
  extractClaimableFundingProofFromManageUrl,
} from "@/lib/claimable-share";
import {
  loadClaimableRecords,
  removeClaimableRecord,
  type ClaimableStoreRecord,
} from "@/lib/claimable-store";
import { estimateClaimableExpiry } from "@/lib/claimable-expiry";
import { MIN_RELIABLE_MAINNET_OUTPUT_KAS } from "@/lib/mainnet-amount-policy";
import {
  buildCreatorProfilePath,
  buildXBioText,
  buildXIntentUrl,
  buildXPostText,
} from "@/lib/share-text";

import { SESSION_EVENT } from "../BrandNav";

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";
const ANALYTICS_WINDOW_LABEL = "last 90d";

type CreatorLink = {
  amountKas: null | string;
  createdAt: string;
  description: null | string;
  disabledAt: null | string;
  // Fundraising target for goal/crowdfunding links. Null/absent for every
  // other type. Optional because pre-goal API responses never sent it.
  goalAutoClose?: boolean;
  goalKas?: null | string;
  // Whether this link is hidden from the creator's public profile page.
  // Optional in the type because old API responses (pre-profile-pages)
  // never sent it — the UI defaults to false when missing.
  hiddenFromProfile?: boolean;
  message: null | string;
  network: "mainnet" | "testnet";
  noteRequired?: boolean;
  publicId: string;
  recipientAddress: string;
  sharePath: string;
  slug: null | string;
  title: string;
  type: string;
};

type LinkTypeFilter =
  | "all"
  | "kaspa.tip"
  | "kaspa.donation"
  | "kaspa.invoice"
  | "kaspa.transfer"
  | "kaspa.goal"
  | "kaspa.claimable";

const LINK_TYPE_FILTERS: Array<{ label: string; value: LinkTypeFilter }> = [
  { label: "All", value: "all" },
  { label: "Tip", value: "kaspa.tip" },
  { label: "Donation", value: "kaspa.donation" },
  { label: "Invoice", value: "kaspa.invoice" },
  { label: "Transfer", value: "kaspa.transfer" },
  { label: "Goal", value: "kaspa.goal" },
  { label: "Claimable", value: "kaspa.claimable" },
];

type EditForm = {
  amountKas: string;
  description: string;
  goalAutoClose: boolean;
  message: string;
  noteRequired: boolean;
  title: string;
};

type AddressPayment = {
  amountKas: string;
  amountSompi: string;
  blockTime: null | number;
  outputIndex: number;
  transactionId: string;
};

type AddressPaymentSummary = {
  count: number;
  providerId: string;
  scanLimit: number;
  totalKas: string;
  totalSompi: string;
};

type PaymentState = {
  error: null | string;
  loading: boolean;
  payments: AddressPayment[];
  summary: AddressPaymentSummary | null;
};

type LinkAnalytics = {
  confirmedPayments: {
    last7d: number;
    total: number;
  };
  conversion: {
    confirmedFromViewRate: number;
    requestFromViewRate: number;
  };
  error: null | string;
  loading: boolean;
  paymentRequests: {
    last7d: number;
    total: number;
  };
  referrers: Array<{
    count: number;
    label: string;
  }>;
  uniqueVisitors: {
    last7d: number;
    total: number;
  };
  views: {
    last7d: number;
    total: number;
  };
};

type ProfileFilter = "all" | "hidden" | "visible";

function readSessionValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function compactAddress(address: string): string {
  if (address.length <= 28) {
    return address;
  }
  return `${address.slice(0, 14)}...${address.slice(-10)}`;
}

function compactTxId(txId: string): string {
  if (txId.length <= 18) {
    return txId;
  }
  return `${txId.slice(0, 10)}...${txId.slice(-6)}`;
}

function kaspaStreamTransactionUrl(txId: string, network: CreatorLink["network"]): null | string {
  if (network !== "mainnet" || !/^[0-9a-f]+$/i.test(txId)) {
    return null;
  }
  return `https://kaspa.stream/transactions/${encodeURIComponent(txId)}`;
}

// Friendly label for an Action type. Mirrors the maps used on /stats and the
// dashboard so a goal link reads "Goal", not the raw wire value "kaspa.goal".
const TYPE_LABELS: Record<string, string> = {
  "kaspa.donation": "Donation",
  "kaspa.goal": "Goal",
  "kaspa.invoice": "Invoice",
  "kaspa.tip": "Tip",
  "kaspa.transfer": "Transfer",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/^kaspa\./, "");
}

function formatAnalyticsRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatAnalyticsCount(count: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(count);
}

function analyticsCompactSummary(analyticsState: LinkAnalytics | undefined): string {
  if (analyticsState?.loading) {
    return "Loading…";
  }
  if (analyticsState?.error) {
    return "Unavailable";
  }
  if (!analyticsState) {
    return "No data yet";
  }

  return `${formatAnalyticsCount(analyticsState.views.total)} views · ${formatAnalyticsCount(
    analyticsState.paymentRequests.total,
  )} pay starts · ${formatAnalyticsCount(analyticsState.confirmedPayments.total)} confirmed`;
}

function funnelWidth(value: number, views: number): number {
  if (views <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(4, Math.round((value / views) * 100)));
}

function LinkAnalyticsFunnel({ analyticsState }: { analyticsState: LinkAnalytics }) {
  const views = analyticsState.views.total;
  const steps = [
    {
      detail: ANALYTICS_WINDOW_LABEL,
      label: "Views",
      value: views,
      width: views > 0 ? 100 : 0,
    },
    {
      detail: `${formatAnalyticsRate(analyticsState.conversion.requestFromViewRate)} from views`,
      label: "Pay starts",
      value: analyticsState.paymentRequests.total,
      width: funnelWidth(analyticsState.paymentRequests.total, views),
    },
    {
      detail: `${formatAnalyticsRate(analyticsState.conversion.confirmedFromViewRate)} from views`,
      label: "Confirmed",
      value: analyticsState.confirmedPayments.total,
      width: funnelWidth(analyticsState.confirmedPayments.total, views),
    },
  ];

  return (
    <div className="link-card-funnel" aria-label="Conversion funnel">
      <div className="link-card-funnel-head">
        <span>Conversion funnel</span>
        <span>{ANALYTICS_WINDOW_LABEL}</span>
      </div>
      {steps.map((step) => (
        <div className="link-card-funnel-row" key={step.label}>
          <span className="link-card-funnel-label">{step.label}</span>
          <span className="link-card-funnel-value">
            {formatAnalyticsCount(step.value)}
            <small>{step.detail}</small>
          </span>
          <span className="link-card-funnel-track" aria-hidden="true">
            <span className="link-card-funnel-fill" style={{ width: `${step.width}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function LinkAnalyticsMetrics({ analyticsState }: { analyticsState: LinkAnalytics | undefined }) {
  if (analyticsState?.loading) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        Loading analytics…
      </p>
    );
  }

  if (analyticsState?.error) {
    return (
      <p className="error-text" style={{ margin: 0 }}>
        {analyticsState.error}
      </p>
    );
  }

  if (!analyticsState) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        No analytics loaded yet.
      </p>
    );
  }

  return (
    <>
      <div className="link-card-analytics-grid">
        <div>
          <span className="label">Views</span>
          <strong>{analyticsState.views.total}</strong>
          <small>
            {ANALYTICS_WINDOW_LABEL} · +{analyticsState.views.last7d} last 7d
          </small>
        </div>
        <div>
          <span className="label">Visitors</span>
          <strong>{analyticsState.uniqueVisitors.total}</strong>
          <small>daily estimate · {ANALYTICS_WINDOW_LABEL}</small>
        </div>
        <div>
          <span className="label">Pay starts</span>
          <strong>{analyticsState.paymentRequests.total}</strong>
          <small>
            {formatAnalyticsRate(analyticsState.conversion.requestFromViewRate)} from views
          </small>
        </div>
        <div>
          <span className="label">Confirmed</span>
          <strong>{analyticsState.confirmedPayments.total}</strong>
          <small>
            {formatAnalyticsRate(analyticsState.conversion.confirmedFromViewRate)} from views
          </small>
        </div>
      </div>
      <LinkAnalyticsFunnel analyticsState={analyticsState} />
      {analyticsState.referrers.length > 0 ? (
        <p className="link-card-analytics-referrers">
          Top referrers:{" "}
          {analyticsState.referrers
            .map((referrer) => `${referrer.label} (${referrer.count})`)
            .join(", ")}
        </p>
      ) : null}
    </>
  );
}

function isShownOnProfile(link: CreatorLink): boolean {
  return link.disabledAt === null && !(link.hiddenFromProfile ?? false);
}

type DbClaimableLink = {
  claimPublicKey: string;
  createdAt: string;
  description: string;
  feeSompi: string;
  fundingOutputIndex: number | null;
  fundingTxId: string | null;
  fundingAddress: string;
  id: string;
  linkKey: string;
  title: string;
  amountSompi: string;
  redeemScriptHex: string;
  refundPublicKey: string;
  status: string;
  refundLockTime: string;
};

type DbClaimableBatch = {
  batchKey: string;
  createdAt: string;
  linkKeys: string[];
  status: string;
  title: string;
};

type MergedClaimable = {
  batchKey: string | null;
  batchTitle: string | null;
  dbId: string | null;
  linkKey: string;
  title: string;
  amountKas: string;
  netClaimKas: string;
  validFor: string;
  createdAtMs: number;
  status: string;
  fundingAddress: string;
  refundLockTime: string;
  claimUrl: string;
  manageUrl: string;
  hasDb: boolean;
  hasLocal: boolean;
};

type ClaimableListGroup = {
  batch: DbClaimableBatch | null;
  key: string;
  records: MergedClaimable[];
};

type ClaimableBatchDeleteTarget = {
  batchKey: string;
  linkCount: number;
  title: string;
};

function formatSompiKas(sompi: string): string {
  try {
    const value = BigInt(sompi);
    const whole = value / 100000000n;
    const frac = (value % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
    return frac ? `${whole.toString()}.${frac}` : whole.toString();
  } catch {
    return "0";
  }
}

function recoverClaimUrl(linkKey: string, status: string, local: ClaimableStoreRecord): string {
  try {
    if (local.claimUrl) return buildCompactClaimUrl(local.claimUrl);
    if (!local.claimCode || status === "awaiting_funding") return "";
    const origin =
      typeof window === "undefined" ? "https://kaspalinks.com" : window.location.origin;
    return buildCompactClaimUrl(
      `${origin}/claim?link=${encodeURIComponent(linkKey)}`,
      local.claimCode,
    );
  } catch {
    return "";
  }
}

function recoverManageUrl(db: DbClaimableLink, local: ClaimableStoreRecord): string {
  if (local.manageUrl) return local.manageUrl;
  if (
    !local.refundCode ||
    !db.fundingTxId ||
    db.fundingOutputIndex === null ||
    !db.redeemScriptHex ||
    !db.refundPublicKey
  ) {
    return "";
  }

  const amountKas = formatSompiKas(db.amountSompi);
  const feeKas = formatSompiKas(db.feeSompi);
  const netClaimKas = formatSompiKas((BigInt(db.amountSompi) - BigInt(db.feeSompi)).toString());
  const origin = typeof window === "undefined" ? "https://kaspalinks.com" : window.location.origin;
  return buildClaimableManageUrl(origin, {
    amountKas,
    amountSompi: db.amountSompi,
    createdAt: db.createdAt,
    createdAtMs: new Date(db.createdAt).getTime(),
    description: db.description,
    feeKas,
    feeSompi: db.feeSompi,
    fundingAddress: db.fundingAddress,
    fundingMatch: {
      amountSompi: db.amountSompi,
      blockTime: null,
      outputIndex: db.fundingOutputIndex,
      transactionId: db.fundingTxId,
    },
    id: db.linkKey,
    netClaimKas,
    redeemScriptHex: db.redeemScriptHex,
    refundCode: local.refundCode,
    refundLockTime: db.refundLockTime,
    refundPublicKey: db.refundPublicKey,
    title: db.title,
    validFor: local.validFor,
    version: 1,
  });
}

function mergeClaimable(
  batches: DbClaimableBatch[],
  dbLinks: DbClaimableLink[],
  localRecords: ClaimableStoreRecord[],
  deletedLinkKeys: ReadonlySet<string>,
): MergedClaimable[] {
  const byKey = new Map<string, MergedClaimable>();
  const dbByKey = new Map(dbLinks.map((link) => [link.linkKey, link]));
  const batchByLinkKey = new Map<string, DbClaimableBatch>();
  for (const batch of batches) {
    for (const linkKey of batch.linkKeys) batchByLinkKey.set(linkKey, batch);
  }
  // DB is authoritative for the list + status (durable, cross-device).
  for (const db of dbLinks) {
    const batch = batchByLinkKey.get(db.linkKey) ?? null;
    byKey.set(db.linkKey, {
      batchKey: batch?.batchKey ?? null,
      batchTitle: batch?.title ?? null,
      dbId: db.id,
      linkKey: db.linkKey,
      title: db.title,
      amountKas: formatSompiKas(db.amountSompi),
      netClaimKas: formatSompiKas((BigInt(db.amountSompi) - BigInt(db.feeSompi)).toString()),
      validFor: "",
      createdAtMs: new Date(db.createdAt).getTime(),
      status: db.status,
      fundingAddress: db.fundingAddress,
      refundLockTime: db.refundLockTime,
      claimUrl: "",
      manageUrl: "",
      hasDb: true,
      hasLocal: false,
    });
  }
  // localStorage adds the bearer secrets (claim/refund URLs) held only on this
  // device, and any links not yet mirrored to the DB.
  for (const local of localRecords) {
    if (deletedLinkKeys.has(local.id)) continue;
    const existing = byKey.get(local.id);
    if (existing) {
      const db = dbByKey.get(local.id);
      existing.claimUrl = recoverClaimUrl(existing.linkKey, existing.status, local);
      existing.manageUrl = db ? recoverManageUrl(db, local) : local.manageUrl;
      existing.netClaimKas = local.netClaimKas;
      existing.validFor = local.validFor;
      existing.refundLockTime = local.refundLockTime;
      existing.hasLocal = true;
    } else {
      byKey.set(local.id, {
        batchKey: null,
        batchTitle: null,
        dbId: null,
        linkKey: local.id,
        title: local.title,
        amountKas: local.amountKas,
        netClaimKas: local.netClaimKas,
        validFor: local.validFor,
        createdAtMs: local.createdAtMs,
        status: local.status,
        fundingAddress: local.fundingAddress,
        refundLockTime: local.refundLockTime,
        claimUrl: recoverClaimUrl(local.id, local.status, local),
        manageUrl: local.manageUrl,
        hasDb: false,
        hasLocal: true,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

function groupClaimableLinks(
  records: MergedClaimable[],
  batches: DbClaimableBatch[],
): ClaimableListGroup[] {
  const batchByKey = new Map(batches.map((batch) => [batch.batchKey, batch]));
  const groups: ClaimableListGroup[] = [];
  const groupByBatchKey = new Map<string, ClaimableListGroup>();

  for (const record of records) {
    if (!record.batchKey) {
      groups.push({ batch: null, key: `link:${record.linkKey}`, records: [record] });
      continue;
    }

    const existing = groupByBatchKey.get(record.batchKey);
    if (existing) {
      existing.records.push(record);
      continue;
    }

    const group = {
      batch: batchByKey.get(record.batchKey) ?? null,
      key: `batch:${record.batchKey}`,
      records: [record],
    } satisfies ClaimableListGroup;
    groups.push(group);
    groupByBatchKey.set(record.batchKey, group);
  }

  return groups;
}

function sumClaimableKas(records: MergedClaimable[]): string {
  const totalSompi = records.reduce((total, record) => {
    const normalized = record.netClaimKas.trim();
    if (!/^\d+(?:\.\d{1,8})?$/.test(normalized)) return total;
    const [whole = "0", fraction = ""] = normalized.split(".");
    return total + BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0"));
  }, 0n);
  return formatSompiKas(totalSompi.toString());
}

function computeClaimableStats(
  records: Array<{ amountKas: string; refundLockTime: string; status: string }>,
  expiryContext: { currentDaaScore: string; daaLoadedAtMs: null | number; nowMs: number },
): {
  total: number;
  lockedKas: string;
  claimed: number;
  refundable: number;
} {
  let locked = 0;
  let claimed = 0;
  let refundable = 0;
  for (const record of records) {
    if (
      record.status === "claimed" ||
      record.status === "refunded" ||
      record.status === "spent_unknown"
    ) {
      if (record.status === "claimed") claimed += 1;
      continue;
    }
    const amount = Number.parseFloat(record.amountKas);
    if (Number.isFinite(amount)) locked += amount;
    const expiry = estimateClaimableExpiry({
      currentDaaScore: expiryContext.currentDaaScore,
      daaLoadedAtMs: expiryContext.daaLoadedAtMs,
      nowMs: expiryContext.nowMs,
      refundLockTime: record.refundLockTime,
    });
    if (record.status === "refundable" || expiry?.expired === true) refundable += 1;
  }
  return {
    total: records.length,
    lockedKas: locked.toLocaleString(undefined, { maximumFractionDigits: 4 }),
    claimed,
    refundable,
  };
}

function humanClaimableStatus(status: string): string {
  switch (status) {
    case "awaiting_funding":
      return "Awaiting funding";
    case "funded":
    case "shared":
      return "Funded";
    case "claimed":
      return "Claimed";
    case "refunded":
      return "Refunded";
    case "refundable":
      return "Ready to refund";
    case "spent_unknown":
      return "Spent on-chain";
    default:
      return status;
  }
}

function claimableStatusPillClass(status: string): string {
  switch (status) {
    case "claimed":
      return "status-confirmed";
    case "refunded":
      return "status-confirmed";
    case "refundable":
    case "spent_unknown":
      return "status-expired";
    case "awaiting_funding":
      return "status-pending";
    default:
      return "status-profile-visible";
  }
}

function isClaimableTerminal(status: string): boolean {
  return status === "claimed" || status === "refunded" || status === "spent_unknown";
}

function canDeleteClaimable(status: string): boolean {
  return status === "awaiting_funding" || isClaimableTerminal(status);
}

function canRequestClaimableDeletion(record: Pick<MergedClaimable, "status">): boolean {
  return canDeleteClaimable(record.status);
}

function formatClaimableEndTime(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(timestampMs));
}

export function MyLinksClient() {
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [links, setLinks] = useState<CreatorLink[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<null | string>(null);
  const [status, setStatus] = useState<null | string>(null);
  const [payments, setPayments] = useState<Record<string, PaymentState>>({});
  const [analytics, setAnalytics] = useState<Record<string, LinkAnalytics>>({});
  const [copied, setCopied] = useState<null | string>(null);
  const [editingId, setEditingId] = useState<null | string>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    amountKas: "",
    description: "",
    goalAutoClose: false,
    message: "",
    noteRequired: false,
    title: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [qrOpenId, setQrOpenId] = useState<null | string>(null);
  // Which link's "More" overflow menu (Edit / Disable / Hide / Delete) is open.
  const [menuOpenId, setMenuOpenId] = useState<null | string>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<LinkTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "disabled">("all");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("all");
  // Set right after a creator returns from /new-link via ?created=<publicId>.
  // Drives the success banner + auto-opens that link's QR so the very first
  // thing they see is a shareable code, not a wall of cards.
  const [createdId, setCreatedId] = useState<null | string>(null);
  const [expandedLinks, setExpandedLinks] = useState<Set<string>>(new Set());

  function toggleLinkExpanded(publicId: string) {
    setExpandedLinks((current) => {
      const next = new Set(current);
      if (next.has(publicId)) {
        next.delete(publicId);
      } else {
        next.add(publicId);
      }
      return next;
    });
  }
  const [claimableRecords, setClaimableRecords] = useState<ClaimableStoreRecord[]>([]);
  const [loadingClaimables, setLoadingClaimables] = useState(false);
  const [claimableSelectionMode, setClaimableSelectionMode] = useState(false);
  const [expandedClaimableBatches, setExpandedClaimableBatches] = useState<Set<string>>(
    () => new Set(),
  );
  const [claimableQuery, setClaimableQuery] = useState("");
  const [claimableStatusFilter, setClaimableStatusFilter] = useState<
    "all" | "available" | "claimable_closed" | "claimed" | "refundable"
  >("all");
  const [selectedClaimableKeys, setSelectedClaimableKeys] = useState<Set<string>>(new Set());
  const [bulkDeletingClaimables, setBulkDeletingClaimables] = useState(false);
  const [showClaimableDeleteDialog, setShowClaimableDeleteDialog] = useState(false);
  const [claimableDeleteTarget, setClaimableDeleteTarget] = useState<MergedClaimable | null>(null);
  const [claimableBatchDeleteTarget, setClaimableBatchDeleteTarget] =
    useState<ClaimableBatchDeleteTarget | null>(null);
  const [claimableDeleteError, setClaimableDeleteError] = useState<null | string>(null);
  const [deletingClaimable, setDeletingClaimable] = useState(false);
  const [deletingClaimableBatch, setDeletingClaimableBatch] = useState(false);
  const [claimableQr, setClaimableQr] = useState<null | {
    dataUrl: string;
    linkKey: string;
    title: string;
  }>(null);
  const [claimableQrLoadingId, setClaimableQrLoadingId] = useState("");
  const claimableLoadInFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const refresh = () => {
      void loadClaimableRecords()
        .then(setClaimableRecords)
        .catch(() => setClaimableRecords([]));
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // claimableStats is derived from the merged DB+local list, defined below.
  // Scroll-to-the-new-card only once — re-running loadLinks (refresh, toggle)
  // shouldn't keep yanking the viewport back to the created card.
  const scrolledToCreatedRef = useRef(false);

  const signedIn = username.length > 0 && token.length > 0;
  const profileVisibleCount = useMemo(() => links.filter(isShownOnProfile).length, [links]);
  const profileHiddenCount = links.length - profileVisibleCount;

  const authHeaders = useMemo(
    () => ({
      "x-creator-token": token,
      "x-creator-username": username,
    }),
    [token, username],
  );

  const [dbClaimableLinks, setDbClaimableLinks] = useState<DbClaimableLink[]>([]);
  const [dbClaimableBatches, setDbClaimableBatches] = useState<DbClaimableBatch[]>([]);
  const [deletedClaimableLinkKeys, setDeletedClaimableLinkKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [claimableDaaScore, setClaimableDaaScore] = useState("");
  const [claimableDaaLoadedAtMs, setClaimableDaaLoadedAtMs] = useState<null | number>(null);
  const [claimableNowMs, setClaimableNowMs] = useState(() => Date.now());

  const loadClaimableLinks = useCallback(
    (showLoading = true): Promise<void> => {
      if (!signedIn) return Promise.resolve();
      if (claimableLoadInFlightRef.current) return claimableLoadInFlightRef.current;

      if (showLoading) setLoadingClaimables(true);
      const request = fetch("/api/creator/claimable-links", {
        cache: "no-store",
        headers: authHeaders,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          if (!body || !Array.isArray(body.claimableLinks)) return;
          setDbClaimableLinks(body.claimableLinks as DbClaimableLink[]);
          setDbClaimableBatches(
            Array.isArray(body.claimableBatches)
              ? (body.claimableBatches as DbClaimableBatch[])
              : [],
          );
          setDeletedClaimableLinkKeys(
            new Set(
              Array.isArray(body.deletedClaimableLinkKeys)
                ? body.deletedClaimableLinkKeys.filter(
                    (value: unknown): value is string => typeof value === "string",
                  )
                : [],
            ),
          );
        })
        .catch(() => {})
        .finally(() => {
          if (claimableLoadInFlightRef.current === request) {
            claimableLoadInFlightRef.current = null;
          }
          if (showLoading) setLoadingClaimables(false);
        });

      claimableLoadInFlightRef.current = request;
      return request;
    },
    [authHeaders, signedIn],
  );

  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadClaimableLinks(false);
    };

    void loadClaimableLinks(true);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadClaimableLinks, signedIn]);

  const mergedClaimable = useMemo(
    () =>
      mergeClaimable(
        dbClaimableBatches,
        dbClaimableLinks,
        claimableRecords,
        deletedClaimableLinkKeys,
      ),
    [claimableRecords, dbClaimableBatches, dbClaimableLinks, deletedClaimableLinkKeys],
  );
  const claimableStats = useMemo(
    () =>
      computeClaimableStats(mergedClaimable, {
        currentDaaScore: claimableDaaScore,
        daaLoadedAtMs: claimableDaaLoadedAtMs,
        nowMs: claimableNowMs,
      }),
    [claimableDaaLoadedAtMs, claimableDaaScore, claimableNowMs, mergedClaimable],
  );

  useEffect(() => {
    if (!signedIn || !mergedClaimable.some((record) => !isClaimableTerminal(record.status))) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadClaimableLinks(false);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [loadClaimableLinks, mergedClaimable, signedIn]);
  const filteredClaimables = useMemo(() => {
    const normalizedQuery = claimableQuery.trim().toLowerCase();
    return mergedClaimable.filter((record) => {
      const expiry = estimateClaimableExpiry({
        currentDaaScore: claimableDaaScore,
        daaLoadedAtMs: claimableDaaLoadedAtMs,
        nowMs: claimableNowMs,
        refundLockTime: record.refundLockTime,
      });
      const terminal = isClaimableTerminal(record.status);
      const refundable = !terminal && (record.status === "refundable" || expiry?.expired === true);
      const matchesStatus =
        claimableStatusFilter === "all" ||
        (claimableStatusFilter === "available" && !terminal && !refundable) ||
        (claimableStatusFilter === "refundable" && refundable) ||
        (claimableStatusFilter === "claimed" && record.status === "claimed") ||
        (claimableStatusFilter === "claimable_closed" &&
          (record.status === "refunded" || record.status === "spent_unknown"));
      if (!matchesStatus) return false;
      if (!normalizedQuery) return true;
      return [record.title, record.fundingAddress, record.status, "kaspa.claimable"]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [
    claimableDaaLoadedAtMs,
    claimableDaaScore,
    claimableNowMs,
    claimableStatusFilter,
    claimableQuery,
    mergedClaimable,
  ]);
  const groupedClaimables = useMemo(
    () => groupClaimableLinks(filteredClaimables, dbClaimableBatches),
    [dbClaimableBatches, filteredClaimables],
  );
  const claimableFiltersActive =
    claimableQuery.trim().length > 0 || claimableStatusFilter !== "all";
  const deletableClaimables = useMemo(
    () => mergedClaimable.filter((record) => canRequestClaimableDeletion(record)),
    [mergedClaimable],
  );
  const selectedDeletableClaimables = useMemo(
    () => deletableClaimables.filter((record) => selectedClaimableKeys.has(record.linkKey)),
    [deletableClaimables, selectedClaimableKeys],
  );
  const allDeletableClaimablesSelected =
    deletableClaimables.length > 0 &&
    deletableClaimables.every((record) => selectedClaimableKeys.has(record.linkKey));

  useEffect(() => {
    setSelectedClaimableKeys((current) => {
      const availableKeys = new Set(
        mergedClaimable
          .filter((record) => canRequestClaimableDeletion(record))
          .map((record) => record.linkKey),
      );
      const next = new Set(Array.from(current).filter((linkKey) => availableKeys.has(linkKey)));
      return next.size === current.size ? current : next;
    });
  }, [mergedClaimable]);

  useEffect(() => {
    const hasLiveClaimable = mergedClaimable.some(
      (record) => !isClaimableTerminal(record.status) && record.refundLockTime,
    );
    if (!hasLiveClaimable) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/toccata-lab/dag-info");
        const body = (await response.json()) as { virtualDaaScore?: unknown };
        if (!cancelled && response.ok && typeof body.virtualDaaScore === "string") {
          setClaimableDaaScore(body.virtualDaaScore);
          setClaimableDaaLoadedAtMs(Date.now());
        }
      } catch {
        // The existing duration remains visible if the public DAA endpoint is temporarily down.
      }
    };

    void refresh();
    const daaTimer = window.setInterval(() => void refresh(), 30_000);
    const clockTimer = window.setInterval(() => setClaimableNowMs(Date.now()), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(daaTimer);
      window.clearInterval(clockTimer);
    };
  }, [mergedClaimable]);

  const removeClaimableLink = useCallback(
    async (record: MergedClaimable): Promise<null | string> => {
      try {
        if (record.hasDb) {
          const response = await fetch(
            `/api/creator/claimable-links?linkKey=${encodeURIComponent(record.linkKey)}`,
            {
              headers: authHeaders,
              method: "DELETE",
            },
          );
          const body = (await response.json().catch(() => null)) as null | {
            error?: { message?: string };
          };
          if (!response.ok) {
            return body?.error?.message ?? "Could not delete claimable link.";
          }
          setDbClaimableLinks((current) =>
            current.filter((link) => link.linkKey !== record.linkKey),
          );
        } else if (!isClaimableTerminal(record.status)) {
          const proof = extractClaimableFundingProofFromManageUrl(record.manageUrl, record.linkKey);
          const response = await fetch("/api/toccata-lab/funding-status", {
            body: JSON.stringify(proof),
            headers: { "content-type": "application/json" },
            method: "POST",
          });
          const body = (await response.json().catch(() => null)) as null | {
            error?: { message?: string };
            outputStatus?: unknown;
          };
          if (!response.ok) {
            return body?.error?.message ?? "Could not verify this local link on-chain.";
          }
          if (body?.outputStatus !== "spent") {
            return "This link still holds KAS on-chain. Complete the refund first, wait for confirmation, then try deleting it again.";
          }
        }

        if (record.hasLocal) {
          setClaimableRecords(await removeClaimableRecord(record.linkKey));
        }
        return null;
      } catch {
        return "Network error while deleting claimable link.";
      }
    },
    [authHeaders],
  );

  const deleteClaimableLink = useCallback((record: MergedClaimable) => {
    const deletionAllowed = canRequestClaimableDeletion(record);
    if (!deletionAllowed) {
      setListError("This link must be claimed or refunded before it can be deleted.");
      return;
    }

    setClaimableDeleteError(null);
    setClaimableDeleteTarget(record);
  }, []);

  const confirmClaimableDeletion = useCallback(async () => {
    if (!claimableDeleteTarget || deletingClaimable) return;

    setDeletingClaimable(true);
    setClaimableDeleteError(null);
    setListError(null);
    setStatus(null);
    const deletionError = await removeClaimableLink(claimableDeleteTarget);
    setDeletingClaimable(false);
    if (deletionError) {
      setClaimableDeleteError(deletionError);
      return;
    }

    setClaimableDeleteTarget(null);
    setStatus("Claimable link deleted.");
  }, [claimableDeleteTarget, deletingClaimable, removeClaimableLink]);

  const confirmClaimableBatchDeletion = useCallback(async () => {
    if (!claimableBatchDeleteTarget || deletingClaimableBatch) return;

    setDeletingClaimableBatch(true);
    setClaimableDeleteError(null);
    setListError(null);
    setStatus(null);
    try {
      const response = await fetch(
        `/api/creator/claimable-batches?batchKey=${encodeURIComponent(
          claimableBatchDeleteTarget.batchKey,
        )}`,
        { headers: authHeaders, method: "DELETE" },
      );
      const body = (await response.json().catch(() => null)) as null | {
        deletedLinkKeys?: unknown;
        error?: { message?: string };
      };
      if (!response.ok) {
        setClaimableDeleteError(body?.error?.message ?? "Could not delete claimable batch.");
        return;
      }

      const deletedLinkKeys = Array.isArray(body?.deletedLinkKeys)
        ? body.deletedLinkKeys.filter(
            (value: unknown): value is string => typeof value === "string",
          )
        : [];
      const deletedKeySet = new Set(deletedLinkKeys);
      setDbClaimableLinks((current) =>
        current.filter((link) => !deletedKeySet.has(link.linkKey)),
      );
      setDbClaimableBatches((current) =>
        current.filter((batch) => batch.batchKey !== claimableBatchDeleteTarget.batchKey),
      );
      setDeletedClaimableLinkKeys((current) => {
        const next = new Set(current);
        for (const linkKey of deletedLinkKeys) next.add(linkKey);
        return next;
      });
      let localRecords = claimableRecords;
      for (const linkKey of deletedLinkKeys) {
        if (localRecords.some((record) => record.id === linkKey)) {
          localRecords = await removeClaimableRecord(linkKey);
        }
      }
      setClaimableRecords(localRecords);
      setSelectedClaimableKeys((current) => {
        const next = new Set(current);
        for (const linkKey of deletedLinkKeys) next.delete(linkKey);
        return next;
      });
      setClaimableBatchDeleteTarget(null);
      setStatus(
        `${claimableBatchDeleteTarget.title} and ${deletedLinkKeys.length} link${
          deletedLinkKeys.length === 1 ? "" : "s"
        } removed from My Links.`,
      );
    } catch {
      setClaimableDeleteError("Network error while deleting claimable batch.");
    } finally {
      setDeletingClaimableBatch(false);
    }
  }, [
    authHeaders,
    claimableBatchDeleteTarget,
    claimableRecords,
    deletingClaimableBatch,
  ]);

  const deleteSelectedClaimableLinks = useCallback(async () => {
    if (selectedDeletableClaimables.length === 0) return;

    setShowClaimableDeleteDialog(false);
    setBulkDeletingClaimables(true);
    setListError(null);
    setStatus(null);
    const failures: Array<{ linkKey: string; message: string }> = [];
    let deleted = 0;

    for (const record of selectedDeletableClaimables) {
      const deletionError = await removeClaimableLink(record);
      if (deletionError) {
        failures.push({ linkKey: record.linkKey, message: deletionError });
      } else {
        deleted += 1;
      }
    }

    setBulkDeletingClaimables(false);
    setSelectedClaimableKeys(new Set(failures.map((failure) => failure.linkKey)));
    if (failures.length > 0) {
      setListError(
        `${deleted} link${deleted === 1 ? "" : "s"} deleted. ${failures.length} could not be deleted: ${failures[0]?.message}`,
      );
      return;
    }
    setClaimableSelectionMode(false);
    setStatus(`${deleted} claimable link${deleted === 1 ? "" : "s"} deleted.`);
  }, [removeClaimableLink, selectedDeletableClaimables]);

  // Hydrate session from sessionStorage and react to sign-out from the brand bar.
  useEffect(() => {
    setUsername(readSessionValue(USERNAME_STORAGE_KEY));
    setToken(readSessionValue(TOKEN_STORAGE_KEY));
    setHydrated(true);

    // Pick up the just-created link from /new-link's redirect, auto-open its
    // QR, then strip the query param so a refresh or Back doesn't re-fire the
    // banner against a link the creator has already seen.
    if (typeof window !== "undefined") {
      const created = new URLSearchParams(window.location.search).get("created");
      if (created) {
        setCreatedId(created);
        setQrOpenId(created);
        const url = new URL(window.location.href);
        url.searchParams.delete("created");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }

    function refresh() {
      setUsername(readSessionValue(USERNAME_STORAGE_KEY));
      setToken(readSessionValue(TOKEN_STORAGE_KEY));
    }

    window.addEventListener(SESSION_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const loadLinks = useCallback(
    async (nextUsername?: string, nextToken?: string) => {
      const effectiveUsername = nextUsername ?? username;
      const effectiveToken = nextToken ?? token;
      if (!effectiveUsername || !effectiveToken) return;

      setLoadingList(true);
      setListError(null);

      const headers = {
        "x-creator-token": effectiveToken,
        "x-creator-username": effectiveUsername,
      };

      try {
        const response = await fetch("/api/creator/actions", { headers });
        const body = await response.json();

        if (!response.ok) {
          setListError(body?.error?.message ?? "Could not load your links.");
          setLoadingList(false);
          return;
        }

        const list: CreatorLink[] = body.actions ?? [];
        setLinks(list);
        setLoadingList(false);

        setPayments(
          Object.fromEntries(
            list.map((link) => [
              link.publicId,
              {
                error: null,
                loading: true,
                payments: [],
                summary: null,
              },
            ]),
          ),
        );
        setAnalytics(
          Object.fromEntries(
            list.map((link) => [
              link.publicId,
              {
                confirmedPayments: { last7d: 0, total: 0 },
                conversion: {
                  confirmedFromViewRate: 0,
                  requestFromViewRate: 0,
                },
                error: null,
                loading: true,
                paymentRequests: { last7d: 0, total: 0 },
                referrers: [],
                uniqueVisitors: { last7d: 0, total: 0 },
                views: { last7d: 0, total: 0 },
              },
            ]),
          ),
        );

        const paymentResponse = await fetch("/api/creator/action-payments", { headers });
        const paymentBody = await paymentResponse.json();

        if (!paymentResponse.ok) {
          setPayments(
            Object.fromEntries(
              list.map((link) => [
                link.publicId,
                {
                  error: paymentBody?.error?.message ?? "Could not load payments for your links.",
                  loading: false,
                  payments: [],
                  summary: null,
                },
              ]),
            ),
          );
          setAnalytics(
            Object.fromEntries(
              list.map((link) => [
                link.publicId,
                {
                  confirmedPayments: { last7d: 0, total: 0 },
                  conversion: {
                    confirmedFromViewRate: 0,
                    requestFromViewRate: 0,
                  },
                  error: "Analytics waits until payments load.",
                  loading: false,
                  paymentRequests: { last7d: 0, total: 0 },
                  referrers: [],
                  uniqueVisitors: { last7d: 0, total: 0 },
                  views: { last7d: 0, total: 0 },
                },
              ]),
            ),
          );
          return;
        }

        const paymentStates = paymentBody.paymentStates ?? {};
        setPayments(
          Object.fromEntries(
            list.map((link) => {
              const state = paymentStates[link.publicId];
              return [
                link.publicId,
                {
                  error: state?.error ?? null,
                  loading: false,
                  payments: state?.payments ?? [],
                  summary: state?.summary ?? null,
                },
              ];
            }),
          ),
        );

        const analyticsResponse = await fetch("/api/creator/action-analytics", { headers });
        const analyticsBody = await analyticsResponse.json();

        if (!analyticsResponse.ok) {
          setAnalytics(
            Object.fromEntries(
              list.map((link) => [
                link.publicId,
                {
                  confirmedPayments: { last7d: 0, total: 0 },
                  conversion: {
                    confirmedFromViewRate: 0,
                    requestFromViewRate: 0,
                  },
                  error: analyticsBody?.error?.message ?? "Could not load link analytics.",
                  loading: false,
                  paymentRequests: { last7d: 0, total: 0 },
                  referrers: [],
                  uniqueVisitors: { last7d: 0, total: 0 },
                  views: { last7d: 0, total: 0 },
                },
              ]),
            ),
          );
          return;
        }

        const analyticsStates = analyticsBody.analytics ?? {};
        setAnalytics(
          Object.fromEntries(
            list.map((link) => {
              const state = analyticsStates[link.publicId];
              return [
                link.publicId,
                {
                  confirmedPayments: state?.confirmedPayments ?? { last7d: 0, total: 0 },
                  conversion: state?.conversion ?? {
                    confirmedFromViewRate: 0,
                    requestFromViewRate: 0,
                  },
                  error: null,
                  loading: false,
                  paymentRequests: state?.paymentRequests ?? { last7d: 0, total: 0 },
                  referrers: state?.referrers ?? [],
                  uniqueVisitors: state?.uniqueVisitors ?? { last7d: 0, total: 0 },
                  views: state?.views ?? { last7d: 0, total: 0 },
                },
              ];
            }),
          ),
        );
      } catch {
        setListError("Network error while loading your links.");
        setLoadingList(false);
      }
    },
    [token, username],
  );

  useEffect(() => {
    if (hydrated && signedIn) {
      void loadLinks();
    }
  }, [hydrated, loadLinks, signedIn]);

  // Close the open "More" menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpenId) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (target?.closest(".link-card-more")) return;
      setMenuOpenId(null);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpenId(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpenId]);

  // Once the freshly created link is in the list, bring its card into view.
  // Guarded by a ref so later list reloads don't keep scrolling the page.
  useEffect(() => {
    if (!createdId || scrolledToCreatedRef.current) return;
    if (!links.some((link) => link.publicId === createdId)) return;
    const card = document.getElementById(`link-card-${createdId}`);
    if (card) {
      scrolledToCreatedRef.current = true;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [createdId, links]);

  const copy = useCallback(async (key: string, value: string) => {
    const ok = await writeClipboardText(value);
    if (ok) {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1600);
    } else {
      setListError("Clipboard copy failed. Select and copy the value manually.");
    }
  }, []);

  async function toggleClaimableQr(record: MergedClaimable, claimUrl: string) {
    if (claimableQr?.linkKey === record.linkKey) {
      setClaimableQr(null);
      return;
    }

    setClaimableQrLoadingId(record.linkKey);
    setListError(null);
    try {
      // Generate locally so the private claim code in the URL fragment never
      // reaches an API, access log, or third-party QR service.
      const QRCode = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(claimUrl, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 720,
      });
      setClaimableQr({ dataUrl, linkKey: record.linkKey, title: record.title });
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Could not create the claim QR code.");
    } finally {
      setClaimableQrLoadingId("");
    }
  }

  const toggleDisabled = useCallback(
    async (link: CreatorLink) => {
      if (!signedIn) return;
      const nextDisabled = link.disabledAt === null;
      try {
        const response = await fetch(`/api/creator/actions/${link.publicId}`, {
          body: JSON.stringify({ disabled: nextDisabled }),
          headers: { ...authHeaders, "content-type": "application/json" },
          method: "PATCH",
        });
        const body = await response.json();
        if (!response.ok) {
          setListError(body?.error?.message ?? "Could not update link.");
          return;
        }
        await loadLinks();
        setStatus(nextDisabled ? "Link disabled." : "Link enabled.");
      } catch {
        setListError("Network error while updating link.");
      }
    },
    [authHeaders, loadLinks, signedIn],
  );

  const toggleProfileVisibility = useCallback(
    async (link: CreatorLink) => {
      if (!signedIn) return;
      const nextHidden = !(link.hiddenFromProfile ?? false);
      try {
        const response = await fetch(`/api/creator/actions/${link.publicId}`, {
          body: JSON.stringify({ hiddenFromProfile: nextHidden }),
          headers: { ...authHeaders, "content-type": "application/json" },
          method: "PATCH",
        });
        const body = await response.json();
        if (!response.ok) {
          setListError(body?.error?.message ?? "Could not update link.");
          return;
        }
        await loadLinks();
        setStatus(nextHidden ? "Hidden from your profile." : "Now visible on your profile.");
      } catch {
        setListError("Network error while updating link.");
      }
    },
    [authHeaders, loadLinks, signedIn],
  );

  const startEditing = useCallback((link: CreatorLink) => {
    setListError(null);
    setStatus(null);
    setEditingId(link.publicId);
    setEditForm({
      amountKas: link.type === "kaspa.goal" ? (link.goalKas ?? "") : (link.amountKas ?? ""),
      description: link.description ?? "",
      goalAutoClose: link.goalAutoClose ?? false,
      message: link.message ?? "",
      noteRequired: link.noteRequired ?? false,
      title: link.title,
    });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setEditForm({
      amountKas: "",
      description: "",
      goalAutoClose: false,
      message: "",
      noteRequired: false,
      title: "",
    });
  }, []);

  const updateEditForm = useCallback((field: keyof EditForm, value: boolean | string) => {
    setEditForm((current) => ({ ...current, [field]: value }));
  }, []);

  const saveEdit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>, link: CreatorLink) => {
      event.preventDefault();
      if (!signedIn || savingEdit) return;

      setSavingEdit(true);
      setListError(null);
      setStatus(null);

      try {
        const normalizedEditAmount = normalizeLocalizedKasAmountInput(editForm.amountKas.trim());
        const response = await fetch(`/api/creator/actions/${link.publicId}`, {
          body: JSON.stringify({
            amountKas: link.type === "kaspa.goal" ? undefined : normalizedEditAmount,
            description: editForm.description,
            goalKas: link.type === "kaspa.goal" ? normalizedEditAmount : undefined,
            goalAutoClose: link.type === "kaspa.goal" ? editForm.goalAutoClose : undefined,
            message: editForm.message,
            noteRequired: editForm.noteRequired,
            title: editForm.title,
          }),
          headers: { ...authHeaders, "content-type": "application/json" },
          method: "PATCH",
        });
        const body = await response.json();
        if (!response.ok) {
          setListError(body?.error?.message ?? "Could not update link.");
          return;
        }

        await loadLinks();
        cancelEditing();
        setStatus("Link updated.");
      } catch {
        setListError("Network error while updating link.");
      } finally {
        setSavingEdit(false);
      }
    },
    [authHeaders, cancelEditing, editForm, loadLinks, savingEdit, signedIn],
  );

  const deleteLink = useCallback(
    async (link: CreatorLink) => {
      if (!signedIn) return;
      const ok = window.confirm(
        `Delete "${link.title}"? The public link will stop working and disappear from your list.`,
      );
      if (!ok) return;

      try {
        const response = await fetch(`/api/creator/actions/${link.publicId}`, {
          headers: authHeaders,
          method: "DELETE",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setListError(body?.error?.message ?? "Could not delete link.");
          return;
        }
        await loadLinks();
        setStatus("Link deleted.");
      } catch {
        setListError("Network error while deleting link.");
      }
    },
    [authHeaders, loadLinks, signedIn],
  );

  const filteredLinks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return links.filter((link) => {
      if (typeFilter === "kaspa.claimable") return false;
      if (typeFilter !== "all" && link.type !== typeFilter) return false;

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && link.disabledAt === null) ||
        (statusFilter === "disabled" && link.disabledAt !== null);
      if (!matchesStatus) return false;

      const shownOnProfile = isShownOnProfile(link);
      const matchesProfile =
        profileFilter === "all" ||
        (profileFilter === "visible" && shownOnProfile) ||
        (profileFilter === "hidden" && !shownOnProfile);
      if (!matchesProfile) return false;

      if (!normalizedQuery) return true;
      return [link.title, link.slug ?? "", link.recipientAddress, link.type]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [links, profileFilter, query, statusFilter, typeFilter]);

  // The link the creator just made, resolved against the loaded list. Null
  // until the list arrives (or after the banner is dismissed).
  const createdLink =
    createdId !== null ? (links.find((link) => link.publicId === createdId) ?? null) : null;
  const createdProfilePath = username ? buildCreatorProfilePath(username) : "";
  const createdProfileUrl =
    createdProfilePath && typeof window !== "undefined"
      ? `${window.location.origin}${createdProfilePath}`
      : createdProfilePath;
  const createdLinkUrl =
    createdLink && typeof window !== "undefined"
      ? `${window.location.origin}${createdLink.sharePath}`
      : (createdLink?.sharePath ?? "");
  const createdPrimaryShareUrl = createdProfileUrl || createdLinkUrl;
  const createdXBioText = createdPrimaryShareUrl ? buildXBioText(createdPrimaryShareUrl) : "";
  const createdXPostText = createdPrimaryShareUrl
    ? buildXPostText({ shareUrl: createdPrimaryShareUrl, title: createdLink?.title })
    : "";
  const createdXIntentUrl = createdPrimaryShareUrl
    ? buildXIntentUrl({
        hashtags: ["Kaspa"],
        text: buildXPostText({ includeUrl: false, title: createdLink?.title }),
        url: createdPrimaryShareUrl,
      })
    : "";
  const createdQrPngUrl = createdLink
    ? `/api/actions/${encodeURIComponent(createdLink.publicId)}/qr?format=png&size=1024`
    : "";
  const createdQrDownloadName = createdLink
    ? `kaspalinks-${createdLink.slug ?? createdLink.publicId}-1024.png`
    : "kaspalinks-link-1024.png";

  // Loading + sign-in branches use `main.main-wide` for the same reason
  // /dashboard does: the brand-bar widens via `body:has(main.main-wide)`,
  // and without the class on the pre-hydration / pre-auth frame the bar
  // briefly collapses to 640px and the logo visibly shifts to the
  // viewport center for one frame. See DashboardClient for the full note.
  if (!hydrated) {
    return (
      <main className="main-wide">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading...
          </p>
        </section>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <main className="main-wide">
        <section className="card card-accent">
          <span className="label">My links</span>
          <h1>Sign in to see your links</h1>
          <p className="muted" style={{ marginBottom: 14 }}>
            Sign in with your creator token, or create a new creator profile to start sharing Kaspa
            links.
          </p>
          <div className="row">
            <Link className="btn btn-primary" href="/sign-in">
              Sign in
            </Link>
            <Link className="btn" href="/create-profile">
              Create profile
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="main-wide">
      <section className="card card-accent">
        <span className="label">My links</span>
        <h1 style={{ marginBottom: 6 }}>Your Kaspa links</h1>
        <p className="muted" style={{ margin: 0 }}>
          Status, recipient address, and the most recent on-chain receipts for each link you own.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn btn-primary" href="/new-link">
            Create a new link
          </Link>
          <button
            className="btn"
            disabled={loadingList || loadingClaimables}
            onClick={() => void Promise.all([loadLinks(), loadClaimableLinks(true)])}
            type="button"
          >
            {loadingList || loadingClaimables ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {createdLink ? (
        <section className="card card-accent link-created-banner" aria-live="polite">
          <div className="link-created-banner-copy">
            <span className="label">Link created</span>
            <h2 className="link-created-banner-title">
              &ldquo;{createdLink.title}&rdquo; is live 🎉
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Your QR code is already open below. Next best step: add your profile link to your X
              bio or post it once so people know where to support you.
            </p>
            {createdPrimaryShareUrl ? (
              <p className="value-mono share-panel-url">{createdPrimaryShareUrl}</p>
            ) : null}
          </div>
          <div className="link-created-share-panel">
            <div className="share-checklist" aria-label="Recommended sharing steps">
              <span className="share-check">
                <span aria-hidden="true" className="share-check-dot" />
                Link page is live
              </span>
              <span className="share-check">
                <span aria-hidden="true" className="share-check-dot" />
                QR is ready below
              </span>
              <span className="share-check">
                <span aria-hidden="true" className="share-check-dot share-check-dot-muted" />
                Add profile to X bio
              </span>
            </div>
            <div className="link-created-primary-actions">
              {createdXIntentUrl ? (
                <a
                  className="btn btn-primary"
                  href={createdXIntentUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Post on X
                </a>
              ) : null}
              {createdProfilePath ? (
                <Link
                  className={createdXIntentUrl ? "btn" : "btn btn-primary"}
                  href={createdProfilePath}
                >
                  View public profile
                </Link>
              ) : null}
            </div>
            <div className="link-created-secondary-actions">
              {createdPrimaryShareUrl ? (
                <button
                  className="btn"
                  onClick={() =>
                    void copy(`created-profile-${createdLink.publicId}`, createdPrimaryShareUrl)
                  }
                  type="button"
                >
                  {copied === `created-profile-${createdLink.publicId}`
                    ? "Share URL copied"
                    : "Copy share URL"}
                </button>
              ) : null}
              {createdXPostText ? (
                <button
                  className="btn"
                  onClick={() =>
                    void copy(`created-post-${createdLink.publicId}`, createdXPostText)
                  }
                  type="button"
                >
                  {copied === `created-post-${createdLink.publicId}`
                    ? "Post text copied"
                    : "Copy post text"}
                </button>
              ) : null}
              {createdXBioText ? (
                <button
                  className="btn"
                  onClick={() => void copy(`created-bio-${createdLink.publicId}`, createdXBioText)}
                  type="button"
                >
                  {copied === `created-bio-${createdLink.publicId}`
                    ? "Bio text copied"
                    : "Copy bio text"}
                </button>
              ) : null}
              {createdQrPngUrl ? (
                <a className="btn" download={createdQrDownloadName} href={createdQrPngUrl}>
                  Download QR
                </a>
              ) : null}
              <Link className="btn" href={createdLink.sharePath}>
                Open payment link
              </Link>
              <button className="btn" onClick={() => setCreatedId(null)} type="button">
                Dismiss
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {listError ? <p className="error-text">{listError}</p> : null}
      {status ? <p className="muted">{status}</p> : null}

      {(loadingList || loadingClaimables) && links.length === 0 && mergedClaimable.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading your links...
          </p>
        </section>
      ) : links.length === 0 && mergedClaimable.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            You don&apos;t have any links yet. <Link href="/new-link">Create your first link</Link>.
          </p>
        </section>
      ) : links.length === 0 ? (
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            You don&apos;t have any regular payment links yet. Your claimable links are listed
            below.
          </p>
        </section>
      ) : (
        <>
          <section className="card link-filters">
            <div>
              <label className="label" htmlFor="link-search">
                Search links
              </label>
              <input
                id="link-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Title, slug, address, or type"
                type="search"
                value={query}
              />
            </div>
            <div>
              <span className="label">Type</span>
              <div className="segmented-control" role="group" aria-label="Filter links by type">
                {LINK_TYPE_FILTERS.map((option) => {
                  const count =
                    option.value === "all"
                      ? links.length + mergedClaimable.length
                      : option.value === "kaspa.claimable"
                        ? mergedClaimable.length
                        : links.filter((link) => link.type === option.value).length;
                  return (
                    <button
                      className={typeFilter === option.value ? "is-active" : ""}
                      key={option.value}
                      onClick={() => setTypeFilter(option.value)}
                      type="button"
                    >
                      {option.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="label">Status</span>
              <div className="segmented-control" role="group" aria-label="Filter links by status">
                {(["all", "active", "disabled"] as const).map((value) => (
                  <button
                    className={statusFilter === value ? "is-active" : ""}
                    key={value}
                    onClick={() => setStatusFilter(value)}
                    type="button"
                  >
                    {value === "all"
                      ? `All (${links.length})`
                      : value === "active"
                        ? `Active (${links.filter((link) => link.disabledAt === null).length})`
                        : `Disabled (${links.filter((link) => link.disabledAt !== null).length})`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Profile</span>
              <div
                className="segmented-control"
                role="group"
                aria-label="Filter links by profile visibility"
              >
                {(["all", "visible", "hidden"] as const).map((value) => (
                  <button
                    className={profileFilter === value ? "is-active" : ""}
                    key={value}
                    onClick={() => setProfileFilter(value)}
                    type="button"
                  >
                    {value === "all"
                      ? `All (${links.length})`
                      : value === "visible"
                        ? `On profile (${profileVisibleCount})`
                        : `Not on profile (${profileHiddenCount})`}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {filteredLinks.length === 0 &&
          !(typeFilter === "kaspa.claimable" && mergedClaimable.length > 0) ? (
            <section className="card">
              <p className="muted" style={{ margin: 0 }}>
                No links match this filter.
              </p>
            </section>
          ) : (
            <ul className="link-list">
              {filteredLinks.map((link) => {
                const paymentState = payments[link.publicId];
                const analyticsState = analytics[link.publicId];
                const absoluteUrl =
                  typeof window !== "undefined"
                    ? `${window.location.origin}${link.sharePath}`
                    : link.sharePath;
                const qrBase = `/api/actions/${encodeURIComponent(link.publicId)}/qr`;
                const qrPreviewSrc = `${qrBase}?format=svg&size=512`;
                const qrSvgUrl = `${qrBase}?format=svg&size=1024`;
                const qrPngUrl = `${qrBase}?format=png&size=1024`;
                const qrPngPrintUrl = `${qrBase}?format=png&size=2048`;
                const disabled = link.disabledAt !== null;
                const shownOnProfile = isShownOnProfile(link);
                const justCreated = link.publicId === createdId;
                const isExpanded =
                  justCreated ||
                  expandedLinks.has(link.publicId) ||
                  editingId === link.publicId ||
                  qrOpenId === link.publicId;
                const xBioText = buildXBioText(absoluteUrl);
                const xPostText = buildXPostText({ shareUrl: absoluteUrl, title: link.title });
                const xIntentUrl = buildXIntentUrl({
                  hashtags: ["Kaspa"],
                  text: buildXPostText({ includeUrl: false, title: link.title }),
                  url: absoluteUrl,
                });
                return (
                  <li
                    className={`card link-card${justCreated ? " link-card-just-created" : ""}`}
                    id={`link-card-${link.publicId}`}
                    key={link.publicId}
                  >
                    <header className="link-card-header">
                      <div className="link-card-titles">
                        <h2 style={{ margin: 0 }}>{link.title}</h2>
                        <p className="muted" style={{ margin: "4px 0 0" }}>
                          {typeLabel(link.type)} ·{" "}
                          {link.goalKas
                            ? `${link.goalKas} KAS goal`
                            : link.amountKas
                              ? `${link.amountKas} KAS`
                              : "Any amount"}
                        </p>
                        {link.description ? (
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            {link.description}
                          </p>
                        ) : null}
                        {link.message ? (
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            Wallet message: &ldquo;{link.message}&rdquo;
                          </p>
                        ) : null}
                        {link.type === "kaspa.goal" && link.goalAutoClose ? (
                          <p className="muted" style={{ margin: "6px 0 0" }}>
                            Auto-closes when the goal target is reached.
                          </p>
                        ) : null}
                      </div>
                      <div className="link-card-statuses" aria-label="Link status">
                        <span
                          className={`status-pill ${
                            disabled ? "status-failed" : "status-confirmed"
                          }`}
                          title={disabled ? "Disabled" : "Active"}
                        >
                          {disabled ? "Disabled" : "Active"}
                        </span>
                        <span
                          className={`status-pill ${
                            shownOnProfile ? "status-profile-visible" : "status-profile-hidden"
                          }`}
                          title={
                            shownOnProfile
                              ? "This active link is visible on your public profile."
                              : disabled
                                ? "Disabled links are not shown on your public profile."
                                : "This link is hidden from your public profile."
                          }
                        >
                          {shownOnProfile ? "On profile" : "Not on profile"}
                        </span>
                      </div>
                    </header>

                    <button
                      aria-controls={`link-card-details-${link.publicId}`}
                      aria-expanded={isExpanded}
                      className="link-card-toggle"
                      onClick={() => toggleLinkExpanded(link.publicId)}
                      type="button"
                    >
                      <span>{isExpanded ? "Hide details" : "Show details"}</span>
                      <span aria-hidden="true">{isExpanded ? "▴" : "▾"}</span>
                    </button>

                    {isExpanded ? (
                      <div className="link-card-details" id={`link-card-details-${link.publicId}`}>
                        <div className="link-card-grid">
                          <div>
                            <span className="label">Total received</span>
                            {paymentState?.loading && !paymentState.summary ? (
                              <p className="muted" style={{ margin: "4px 0 0" }}>
                                Loading…
                              </p>
                            ) : paymentState?.summary ? (
                              <p style={{ margin: "4px 0 0" }}>
                                <strong>{paymentState.summary.totalKas} KAS</strong>{" "}
                                <span className="muted">
                                  · {paymentState.summary.count}{" "}
                                  {paymentState.summary.count === 1 ? "payment" : "payments"} on the
                                  recipient address
                                </span>
                              </p>
                            ) : paymentState?.error ? (
                              <p
                                className="error-text"
                                style={{ margin: "4px 0 0", fontSize: "0.85rem" }}
                              >
                                {paymentState.error}
                              </p>
                            ) : (
                              <p className="muted" style={{ margin: "4px 0 0" }}>
                                —
                              </p>
                            )}
                          </div>
                          <div>
                            <span className="label">Recipient address</span>
                            <p className="value-mono" style={{ margin: "4px 0 0" }}>
                              {compactAddress(link.recipientAddress)}
                            </p>
                            <button
                              className="link-card-inline-btn"
                              onClick={() =>
                                void copy(`addr-${link.publicId}`, link.recipientAddress)
                              }
                              type="button"
                            >
                              {copied === `addr-${link.publicId}`
                                ? "Address copied"
                                : "Copy address"}
                            </button>
                          </div>
                          <div>
                            <span className="label">Public URL</span>
                            <p className="value-mono" style={{ margin: "4px 0 0" }}>
                              {link.sharePath}
                            </p>
                            <button
                              className="link-card-inline-btn"
                              onClick={() => void copy(`url-${link.publicId}`, absoluteUrl)}
                              type="button"
                            >
                              {copied === `url-${link.publicId}` ? "URL copied" : "Copy URL"}
                            </button>
                          </div>
                        </div>

                        <details className="link-card-analytics link-card-analytics-mobile">
                          <summary className="link-card-analytics-summary">
                            <span className="label">Analytics</span>
                            <span className="link-card-analytics-summary-text">
                              {analyticsCompactSummary(analyticsState)}
                            </span>
                          </summary>
                          <div className="link-card-analytics-mobile-body">
                            <LinkAnalyticsMetrics analyticsState={analyticsState} />
                          </div>
                        </details>

                        <section
                          className="link-card-analytics link-card-analytics-desktop"
                          aria-label="Link analytics"
                        >
                          <div className="link-card-analytics-head">
                            <span className="label">Link analytics</span>
                            <span className="muted">Privacy-friendly estimates</span>
                          </div>
                          <LinkAnalyticsMetrics analyticsState={analyticsState} />
                        </section>

                        {qrOpenId === link.publicId ? (
                          <div className="qr-download-panel">
                            <div className="qr-download-preview">
                              <Image
                                alt={`QR code for ${link.title}`}
                                height={196}
                                src={qrPreviewSrc}
                                unoptimized
                                width={196}
                              />
                            </div>
                            <div className="qr-download-copy">
                              <span className="label">QR code target</span>
                              <p className="value-mono">{absoluteUrl}</p>
                              <p className="muted">
                                This QR opens the Kaspa Links payment page first, so supporters can
                                verify the title, amount, recipient, and wallet options before
                                paying.
                              </p>
                              <div className="row">
                                <a
                                  className="btn"
                                  download={`kaspalinks-${link.slug ?? link.publicId}.svg`}
                                  href={qrSvgUrl}
                                >
                                  SVG
                                </a>
                                <a
                                  className="btn"
                                  download={`kaspalinks-${link.slug ?? link.publicId}-1024.png`}
                                  href={qrPngUrl}
                                >
                                  PNG 1024
                                </a>
                                <a
                                  className="btn"
                                  download={`kaspalinks-${link.slug ?? link.publicId}-print.png`}
                                  href={qrPngPrintUrl}
                                >
                                  PNG print
                                </a>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {editingId === link.publicId ? (
                          <form
                            className="link-edit-form"
                            onSubmit={(event) => saveEdit(event, link)}
                          >
                            <div className="form-field">
                              <label className="label" htmlFor={`edit-title-${link.publicId}`}>
                                Title
                              </label>
                              <input
                                id={`edit-title-${link.publicId}`}
                                maxLength={80}
                                onChange={(event) => updateEditForm("title", event.target.value)}
                                required
                                type="text"
                                value={editForm.title}
                              />
                            </div>
                            <div className="form-field">
                              <label
                                className="label"
                                htmlFor={`edit-description-${link.publicId}`}
                              >
                                Description
                              </label>
                              <textarea
                                id={`edit-description-${link.publicId}`}
                                maxLength={280}
                                onChange={(event) =>
                                  updateEditForm("description", event.target.value)
                                }
                                placeholder="Optional public description"
                                value={editForm.description}
                              />
                            </div>
                            <div className="link-edit-form-grid">
                              <div className="form-field">
                                <label className="label" htmlFor={`edit-amount-${link.publicId}`}>
                                  {link.type === "kaspa.goal" ? "Goal target" : "Amount in KAS"}
                                </label>
                                <input
                                  id={`edit-amount-${link.publicId}`}
                                  inputMode="decimal"
                                  onChange={(event) =>
                                    updateEditForm("amountKas", event.target.value)
                                  }
                                  placeholder={
                                    link.type === "kaspa.goal"
                                      ? "Goal target"
                                      : link.type === "kaspa.invoice" ||
                                          link.type === "kaspa.transfer"
                                        ? "Required for this link type"
                                        : "Blank means any amount"
                                  }
                                  type="text"
                                  value={editForm.amountKas}
                                />
                                <p className="form-field-help">
                                  {link.type === "kaspa.goal"
                                    ? "Changing the target recalculates the progress bar. Confirmed payments stay attached to this link."
                                    : `Leave blank for any amount on tip and donation links. Fixed amounts should be at least ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS.`}
                                </p>
                              </div>
                              <div className="form-field">
                                <label className="label" htmlFor={`edit-message-${link.publicId}`}>
                                  Wallet message
                                </label>
                                <input
                                  id={`edit-message-${link.publicId}`}
                                  maxLength={280}
                                  onChange={(event) =>
                                    updateEditForm("message", event.target.value)
                                  }
                                  placeholder="Optional wallet note"
                                  type="text"
                                  value={editForm.message}
                                />
                              </div>
                            </div>
                            <div className="form-field link-edit-toggle-field">
                              <label
                                className="form-toggle"
                                htmlFor={`edit-note-required-${link.publicId}`}
                              >
                                <input
                                  checked={editForm.noteRequired}
                                  id={`edit-note-required-${link.publicId}`}
                                  onChange={(event) =>
                                    updateEditForm("noteRequired", event.target.checked)
                                  }
                                  type="checkbox"
                                />
                                <span className="form-toggle-body">
                                  <span className="form-toggle-title">
                                    Require a note from the supporter
                                  </span>
                                  <span className="form-toggle-help">
                                    Pay button stays disabled until the supporter writes at least 10
                                    characters. Off-chain only, visible to you after confirmation.
                                  </span>
                                </span>
                              </label>
                            </div>
                            {link.type === "kaspa.goal" ? (
                              <div className="form-field link-edit-toggle-field">
                                <label
                                  className="form-toggle"
                                  htmlFor={`edit-goal-auto-close-${link.publicId}`}
                                >
                                  <input
                                    checked={editForm.goalAutoClose}
                                    id={`edit-goal-auto-close-${link.publicId}`}
                                    onChange={(event) =>
                                      updateEditForm("goalAutoClose", event.target.checked)
                                    }
                                    type="checkbox"
                                  />
                                  <span className="form-toggle-body">
                                    <span className="form-toggle-title">
                                      Auto-close when the goal is reached
                                    </span>
                                    <span className="form-toggle-help">
                                      Stops new payment requests after confirmed contributions meet
                                      the target. Use a dedicated recipient address for the cleanest
                                      goal tracking.
                                    </span>
                                  </span>
                                </label>
                              </div>
                            ) : null}
                            <p className="muted link-edit-note">
                              Recipient address and public URL stay unchanged in this quick edit.
                            </p>
                            <div className="row link-card-actions">
                              <button
                                className="btn btn-primary"
                                disabled={savingEdit}
                                type="submit"
                              >
                                {savingEdit ? "Saving..." : "Save changes"}
                              </button>
                              <button
                                className="btn"
                                disabled={savingEdit}
                                onClick={cancelEditing}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : null}

                        {paymentState?.payments && paymentState.payments.length > 0 ? (
                          // Receipts collapsed by default so a long list of links
                          // stays scannable. Native <details>/<summary> instead of
                          // a custom toggle: free keyboard support, free aria
                          // expanded state, and the browser handles the disclosure
                          // triangle / focus ring without us writing any of it.
                          // The summary line gives the count up-front so the
                          // creator knows whether it's worth opening at all.
                          <details className="link-card-payments">
                            <summary className="link-card-payments-summary">
                              <span className="label">Recent receipts</span>
                              <span className="muted link-card-payments-count">
                                {paymentState.payments.length === 1
                                  ? "1 receipt"
                                  : `${Math.min(paymentState.payments.length, 5)} of ${paymentState.payments.length} receipts`}
                              </span>
                            </summary>
                            <ul className="action-payment-list">
                              {paymentState.payments.slice(0, 5).map((payment) => {
                                const explorerUrl = kaspaStreamTransactionUrl(
                                  payment.transactionId,
                                  link.network,
                                );
                                return (
                                  <li
                                    className="action-payment-row"
                                    key={`${payment.transactionId}:${payment.outputIndex}`}
                                  >
                                    <strong>{payment.amountKas} KAS</strong>
                                    <span className="muted">
                                      {payment.blockTime
                                        ? new Date(payment.blockTime).toLocaleString()
                                        : "Time unavailable"}
                                    </span>
                                    <span className="value-mono">
                                      {explorerUrl ? (
                                        <a href={explorerUrl} rel="noreferrer" target="_blank">
                                          {compactTxId(payment.transactionId)}
                                        </a>
                                      ) : (
                                        compactTxId(payment.transactionId)
                                      )}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        ) : null}

                        <div className="row link-card-actions">
                          <Link className="btn" href={link.sharePath}>
                            Open
                          </Link>
                          <button
                            className="btn"
                            onClick={() =>
                              setQrOpenId((current) =>
                                current === link.publicId ? null : link.publicId,
                              )
                            }
                            type="button"
                          >
                            {qrOpenId === link.publicId ? "Hide QR" : "QR Code"}
                          </button>
                          <a className="btn" href={xIntentUrl} rel="noreferrer" target="_blank">
                            Post on X
                          </a>
                          <div className="link-card-more">
                            <button
                              aria-expanded={menuOpenId === link.publicId}
                              aria-haspopup="true"
                              className="btn link-card-more-toggle"
                              onClick={() =>
                                setMenuOpenId((current) =>
                                  current === link.publicId ? null : link.publicId,
                                )
                              }
                              type="button"
                            >
                              More ▾
                            </button>
                            {menuOpenId === link.publicId ? (
                              <div className="link-card-more-menu" role="menu">
                                <button
                                  className="link-card-more-item"
                                  onClick={() => {
                                    void copy(`x-post-${link.publicId}`, xPostText);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  {copied === `x-post-${link.publicId}`
                                    ? "X post copied"
                                    : "Copy X post text"}
                                </button>
                                <button
                                  className="link-card-more-item"
                                  onClick={() => {
                                    void copy(`x-bio-${link.publicId}`, xBioText);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  {copied === `x-bio-${link.publicId}`
                                    ? "Bio text copied"
                                    : "Copy bio text"}
                                </button>
                                <a
                                  className="link-card-more-item"
                                  download={`kaspalinks-${link.slug ?? link.publicId}-1024.png`}
                                  href={qrPngUrl}
                                  role="menuitem"
                                >
                                  Download QR PNG
                                </a>
                                <button
                                  className="link-card-more-item"
                                  onClick={() => {
                                    startEditing(link);
                                    setMenuOpenId(null);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  Edit
                                </button>
                                <button
                                  className="link-card-more-item"
                                  onClick={() => {
                                    void toggleDisabled(link);
                                    setMenuOpenId(null);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  {disabled ? "Enable" : "Disable"}
                                </button>
                                <button
                                  className="link-card-more-item"
                                  onClick={() => {
                                    void toggleProfileVisibility(link);
                                    setMenuOpenId(null);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  {link.hiddenFromProfile ? "Show on profile" : "Hide from profile"}
                                </button>
                                <div className="link-card-more-divider" role="separator" />
                                <button
                                  className="link-card-more-item link-card-more-item-danger"
                                  onClick={() => {
                                    void deleteLink(link);
                                    setMenuOpenId(null);
                                  }}
                                  role="menuitem"
                                  type="button"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {showClaimableDeleteDialog ? (
        <div
          className="batch-wallet-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setShowClaimableDeleteDialog(false);
          }}
          role="presentation"
        >
          <section
            aria-labelledby="claimable-delete-dialog-title"
            aria-modal="true"
            className="batch-wallet-modal claimable-delete-dialog"
            role="dialog"
          >
            <button
              aria-label="Cancel deleting selected links"
              className="batch-wallet-modal-close"
              onClick={() => setShowClaimableDeleteDialog(false)}
              type="button"
            >
              ×
            </button>
            <span className="label">Delete selected links</span>
            <h2 id="claimable-delete-dialog-title">Are you sure?</h2>
            <p>
              Delete {selectedDeletableClaimables.length} selected claimable link
              {selectedDeletableClaimables.length === 1 ? "" : "s"} from My Links and this browser?
            </p>
            <p className="notice notice-critical">
              Every selected link is checked on-chain. Only verified-unfunded or closed links are
              removed. This action does not move any KAS or initiate refunds.
            </p>
            <div className="batch-wallet-modal-actions">
              <button
                className="btn"
                onClick={() => setShowClaimableDeleteDialog(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={selectedDeletableClaimables.length === 0}
                onClick={() => void deleteSelectedClaimableLinks()}
                type="button"
              >
                Delete {selectedDeletableClaimables.length} link
                {selectedDeletableClaimables.length === 1 ? "" : "s"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {claimableDeleteTarget ? (
        <div
          className="batch-wallet-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !deletingClaimable) {
              setClaimableDeleteTarget(null);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="single-claimable-delete-dialog-title"
            aria-modal="true"
            className="batch-wallet-modal claimable-delete-dialog"
            role="dialog"
          >
            <button
              aria-label="Cancel deleting claimable link"
              className="batch-wallet-modal-close"
              disabled={deletingClaimable}
              onClick={() => setClaimableDeleteTarget(null)}
              type="button"
            >
              ×
            </button>
            <span className="label">Remove claimable link</span>
            <h2 id="single-claimable-delete-dialog-title">Check before deleting</h2>
            <p>
              {claimableDeleteTarget.status === "awaiting_funding"
                ? "Kaspa Links will verify that this address was never funded before removing the link."
                : isClaimableTerminal(claimableDeleteTarget.status)
                  ? "This removes the closed link from My Links. It does not move any KAS on-chain."
                  : "Kaspa Links will check the funding output on-chain and delete the link only when it no longer holds KAS."}
            </p>
            {!isClaimableTerminal(claimableDeleteTarget.status) &&
            claimableDeleteTarget.status !== "awaiting_funding" ? (
              <p className="notice notice-critical">
                This check does not refund KAS. Complete the refund first, wait for the transaction
                to be accepted, then run this check again.
              </p>
            ) : null}
            {claimableDeleteError ? (
              <p className="notice notice-critical" role="alert">
                {claimableDeleteError}
              </p>
            ) : null}
            <div className="batch-wallet-modal-actions">
              {!claimableDeleteTarget.manageUrl &&
              claimableDeleteTarget.linkKey.startsWith("batch-") &&
              !isClaimableTerminal(claimableDeleteTarget.status) ? (
                <a
                  className="btn btn-primary"
                  href={
                    claimableDeleteTarget.batchKey
                      ? buildBatchRecoveryPath(
                          claimableDeleteTarget.batchKey,
                          claimableDeleteTarget.batchTitle ?? claimableDeleteTarget.title,
                        )
                      : "/claim/batch-recovery"
                  }
                >
                  Open batch recovery
                </a>
              ) : claimableDeleteTarget.manageUrl &&
                !isClaimableTerminal(claimableDeleteTarget.status) ? (
                <a
                  className="btn"
                  href={claimableDeleteTarget.manageUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open refund
                </a>
              ) : null}
              <button
                className="btn"
                disabled={deletingClaimable}
                onClick={() => setClaimableDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={deletingClaimable}
                onClick={() => void confirmClaimableDeletion()}
                type="button"
              >
                {deletingClaimable
                  ? "Checking…"
                  : isClaimableTerminal(claimableDeleteTarget.status)
                    ? "Delete link"
                    : "Check & delete"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {claimableBatchDeleteTarget ? (
        <div
          className="batch-wallet-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !deletingClaimableBatch) {
              setClaimableBatchDeleteTarget(null);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="claimable-batch-delete-dialog-title"
            aria-modal="true"
            className="batch-wallet-modal claimable-delete-dialog"
            role="dialog"
          >
            <button
              aria-label="Cancel deleting claimable batch"
              className="batch-wallet-modal-close"
              disabled={deletingClaimableBatch}
              onClick={() => setClaimableBatchDeleteTarget(null)}
              type="button"
            >
              ×
            </button>
            <span className="label">Remove claim batch</span>
            <h2 id="claimable-batch-delete-dialog-title">Delete the entire batch?</h2>
            <p>
              Remove <strong>{claimableBatchDeleteTarget.title}</strong> and all{" "}
              {claimableBatchDeleteTarget.linkCount} links from My Links?
            </p>
            <p className="notice notice-critical">
              The batch is removed only when all links are recorded as claimed, refunded, or
              otherwise spent on-chain. This does not move KAS or erase the underlying on-chain
              transactions.
            </p>
            {claimableDeleteError ? (
              <p className="notice notice-critical" role="alert">
                {claimableDeleteError}
              </p>
            ) : null}
            <div className="batch-wallet-modal-actions">
              <button
                className="btn"
                disabled={deletingClaimableBatch}
                onClick={() => setClaimableBatchDeleteTarget(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={deletingClaimableBatch}
                onClick={() => void confirmClaimableBatchDeletion()}
                type="button"
              >
                {deletingClaimableBatch ? "Deleting…" : "Delete entire batch"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {mergedClaimable.length > 0 && (typeFilter === "all" || typeFilter === "kaspa.claimable") ? (
        <section className="card claimable-mylinks">
          <div className="claimable-mylinks-heading">
            <div>
              <span className="label">Claimable links</span>
              <h2 className="form-section-heading">Your claimable links</h2>
            </div>
            <button
              aria-pressed={claimableSelectionMode}
              className="btn"
              disabled={bulkDeletingClaimables || deletableClaimables.length === 0}
              onClick={() => {
                setClaimableSelectionMode((current) => !current);
                setSelectedClaimableKeys(new Set());
                setShowClaimableDeleteDialog(false);
              }}
              type="button"
            >
              {claimableSelectionMode ? "Done" : "Select links"}
            </button>
          </div>
          <div className="claimable-mylinks-stats">
            <div>
              <span className="label">Links</span>
              <strong>{claimableStats.total}</strong>
            </div>
            <div>
              <span className="label">KAS locked</span>
              <strong>{claimableStats.lockedKas}</strong>
            </div>
            <div>
              <span className="label">Claimed</span>
              <strong>{claimableStats.claimed}</strong>
            </div>
            <div>
              <span className="label">Ready to refund</span>
              <strong>{claimableStats.refundable}</strong>
            </div>
          </div>
          <div className="claimable-link-filters">
            <label className="label" htmlFor="claimable-link-search">
              Search claimable links
            </label>
            <input
              id="claimable-link-search"
              onChange={(event) => setClaimableQuery(event.target.value)}
              placeholder="Title, funding address, or status"
              type="search"
              value={claimableQuery}
            />
            <div
              className="segmented-control"
              role="group"
              aria-label="Filter claimable links by status"
            >
              {(
                [
                  ["all", "All"],
                  ["available", "Available"],
                  ["refundable", "Ready to refund"],
                  ["claimed", "Claimed"],
                  ["claimable_closed", "Closed"],
                ] as const
              ).map(([value, label]) => (
                <button
                  className={claimableStatusFilter === value ? "is-active" : ""}
                  key={value}
                  onClick={() => setClaimableStatusFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {claimableSelectionMode ? (
            <div className="claimable-selection-toolbar" role="region" aria-label="Link selection">
              <div>
                <strong>{selectedDeletableClaimables.length} selected</strong>
                <span>Only unfunded or closed links can be deleted.</span>
              </div>
              <div className="claimable-selection-actions">
                <button
                  className="btn"
                  disabled={bulkDeletingClaimables || deletableClaimables.length === 0}
                  onClick={() =>
                    setSelectedClaimableKeys(
                      allDeletableClaimablesSelected
                        ? new Set()
                        : new Set(deletableClaimables.map((record) => record.linkKey)),
                    )
                  }
                  type="button"
                >
                  {allDeletableClaimablesSelected ? "Clear selection" : "Select all deletable"}
                </button>
                <button
                  className="btn btn-danger"
                  disabled={bulkDeletingClaimables || selectedDeletableClaimables.length === 0}
                  onClick={() => setShowClaimableDeleteDialog(true)}
                  type="button"
                >
                  {bulkDeletingClaimables
                    ? "Deleting…"
                    : `Delete selected${selectedDeletableClaimables.length > 0 ? ` (${selectedDeletableClaimables.length})` : ""}`}
                </button>
              </div>
            </div>
          ) : null}
          {filteredClaimables.length === 0 ? (
            <p className="muted">No claimable links match this filter.</p>
          ) : null}
          <ul className="claimable-mylinks-list">
            {(() => {
              const renderClaimableRecord = (record: MergedClaimable) =>
                (() => {
                const expiry = estimateClaimableExpiry({
                  currentDaaScore: claimableDaaScore,
                  daaLoadedAtMs: claimableDaaLoadedAtMs,
                  nowMs: claimableNowMs,
                  refundLockTime: record.refundLockTime,
                });
                // A completed on-chain outcome always wins over the clock. A
                // link may be opened long after it was claimed, but it must
                // still read "Claimed", never "Expired".
                const terminal = isClaimableTerminal(record.status);
                const expired =
                  !terminal && (record.status === "refundable" || expiry?.expired === true);
                const versionedClaimUrl = record.claimUrl
                  ? buildCompactClaimUrl(record.claimUrl)
                  : "";
                const privateRecoveryMissing =
                  !record.manageUrl && record.status !== "awaiting_funding" && !terminal;
                const batchRecoveryMissing =
                  privateRecoveryMissing && record.linkKey.startsWith("batch-");
                const deletable = canRequestClaimableDeletion(record);
                const selected = selectedClaimableKeys.has(record.linkKey);

                return (
                  <li
                    className={`claimable-mylinks-item${expired ? " is-expired" : ""}${selected ? " is-selected" : ""}`}
                    key={record.linkKey}
                  >
                    {claimableSelectionMode ? (
                      <label className="claimable-select-control">
                        <input
                          checked={selected}
                          disabled={!deletable || bulkDeletingClaimables}
                          onChange={(event) => {
                            setSelectedClaimableKeys((current) => {
                              const next = new Set(current);
                              if (event.target.checked) {
                                next.add(record.linkKey);
                              } else {
                                next.delete(record.linkKey);
                              }
                              return next;
                            });
                          }}
                          type="checkbox"
                        />
                        <span>{deletable ? "Select link" : "Close on-chain before deleting"}</span>
                      </label>
                    ) : null}
                    <div className="claimable-mylinks-main">
                      <div className="claimable-mylinks-info">
                        <div className="claimable-mylinks-title-row">
                          <strong>{record.title}</strong>
                          <span
                            className={`status-pill ${
                              expired ? "status-expired" : claimableStatusPillClass(record.status)
                            }`}
                          >
                            {expired ? "Ready to refund" : humanClaimableStatus(record.status)}
                          </span>
                        </div>
                        <p className="muted claimable-mylinks-meta">
                          <strong>{record.netClaimKas} KAS claim</strong>
                          {record.status === "refunded" ? (
                            <span>Refund completed</span>
                          ) : record.status === "claimed" ? (
                            <span>Claim completed</span>
                          ) : record.status === "spent_unknown" ? (
                            <span>Output spent on-chain</span>
                          ) : expired ? (
                            <span className="claimable-mylinks-expired">
                              Claim window closed · refund available
                            </span>
                          ) : expiry ? (
                            <span>
                              Claimable for about {expiry.remainingLabel} · ends about{" "}
                              {formatClaimableEndTime(expiry.endsAtMs)}
                            </span>
                          ) : record.validFor ? (
                            <span>Claim window: {record.validFor}</span>
                          ) : null}
                          <span>Created {new Date(record.createdAtMs).toLocaleDateString()}</span>
                        </p>
                        {expired ? (
                          <p className="claimable-mylinks-expiry-notice">
                            This link can no longer be claimed. The locked KAS are ready to refund
                            with your private refund link.
                          </p>
                        ) : null}
                        {privateRecoveryMissing ? (
                          <p className="claimable-mylinks-expiry-notice">
                            {batchRecoveryMissing
                              ? "This browser does not have the private refund key. Open Batch recovery and restore the private recovery bundle saved before funding."
                              : "This browser does not have the private refund key. Import the private recovery bundle saved before funding, or use the private refund link saved after funding."}
                          </p>
                        ) : null}
                      </div>
                      <div className="claimable-mylinks-actions claimable-mylinks-primary-actions">
                        {versionedClaimUrl && !expired ? (
                          <a
                            className="btn btn-primary"
                            href={versionedClaimUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Open claim
                          </a>
                        ) : null}
                        {versionedClaimUrl && !expired ? (
                          <button
                            className="btn"
                            onClick={() => void copy(`${record.linkKey}-claim`, versionedClaimUrl)}
                            type="button"
                          >
                            {copied === `${record.linkKey}-claim` ? "Copied!" : "Copy claim link"}
                          </button>
                        ) : null}
                        {versionedClaimUrl && !expired ? (
                          <button
                            aria-expanded={claimableQr?.linkKey === record.linkKey}
                            className="btn"
                            disabled={claimableQrLoadingId === record.linkKey}
                            onClick={() => void toggleClaimableQr(record, versionedClaimUrl)}
                            type="button"
                          >
                            {claimableQrLoadingId === record.linkKey
                              ? "Creating QR…"
                              : claimableQr?.linkKey === record.linkKey
                                ? "Hide QR"
                                : "QR Code"}
                          </button>
                        ) : null}
                        {record.manageUrl ? (
                          <a
                            className={expired ? "btn btn-primary" : "btn"}
                            href={record.manageUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {expired ? "Open refund" : "Refund"}
                          </a>
                        ) : privateRecoveryMissing ? (
                          <a
                            className="btn btn-primary"
                            href={
                              batchRecoveryMissing && record.batchKey
                                ? buildBatchRecoveryPath(
                                    record.batchKey,
                                    record.batchTitle ?? record.title,
                                  )
                                : batchRecoveryMissing
                                  ? "/claim/batch-recovery"
                                  : buildClaimableRecoveryPath(record.linkKey, record.title)
                            }
                          >
                            {batchRecoveryMissing ? "Open batch recovery" : "Open recovery"}
                          </a>
                        ) : null}
                      </div>
                    </div>

                    {claimableQr?.linkKey === record.linkKey ? (
                      <div className="qr-download-panel claimable-mylinks-qr-panel">
                        <div className="qr-download-preview">
                          <Image
                            alt={`Claim QR code for ${claimableQr.title}`}
                            height={196}
                            src={claimableQr.dataUrl}
                            unoptimized
                            width={196}
                          />
                        </div>
                        <div className="qr-download-copy">
                          <span className="label">Claim QR code</span>
                          <p>
                            Share this QR to open <strong>{claimableQr.title}</strong> directly.
                          </p>
                          <p className="muted">
                            The QR contains the private claim code. Anyone who scans it can claim
                            the KAS while the link is available. It is generated only in this
                            browser.
                          </p>
                          <div className="row">
                            <a
                              className="btn btn-primary"
                              download={`kaspalinks-${record.linkKey}-claim.png`}
                              href={claimableQr.dataUrl}
                            >
                              Download PNG
                            </a>
                            <button
                              className="btn"
                              onClick={() => setClaimableQr(null)}
                              type="button"
                            >
                              Hide QR
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <details className="claimable-mylinks-details">
                      <summary className="claimable-mylinks-summary">
                        <span>Details</span>
                      </summary>
                      <div className="claimable-mylinks-detail-panel">
                        {record.fundingAddress ? (
                          <div>
                            <span className="label">Funding address</span>
                            <p className="value-mono claimable-mylinks-addr">
                              {record.fundingAddress}
                            </p>
                          </div>
                        ) : null}
                        {!record.hasLocal ? (
                          <p className="muted">
                            Created on another device — the claim/refund links live there.
                          </p>
                        ) : null}
                        <div className="claimable-mylinks-actions">
                          {versionedClaimUrl && !expired ? (
                            <button
                              className="btn"
                              onClick={() => {
                                try {
                                  const intent = buildXIntentUrl({
                                    hashtags: ["Kaspa"],
                                    text: buildClaimableXPostText({
                                      netClaimKas: record.netClaimKas,
                                      title: record.title,
                                    }),
                                    url: versionedClaimUrl,
                                  });
                                  window.open(intent, "_blank", "noopener,noreferrer");
                                } catch (shareError) {
                                  setListError(
                                    shareError instanceof Error
                                      ? shareError.message
                                      : "Could not prepare the claim post.",
                                  );
                                }
                              }}
                              type="button"
                            >
                              Post on X
                            </button>
                          ) : null}
                          {record.manageUrl ? (
                            <a
                              className="btn"
                              href={record.manageUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Refund link
                            </a>
                          ) : privateRecoveryMissing ? (
                            <a
                              className="btn"
                              href={
                                batchRecoveryMissing && record.batchKey
                                  ? buildBatchRecoveryPath(
                                      record.batchKey,
                                      record.batchTitle ?? record.title,
                                    )
                                  : batchRecoveryMissing
                                    ? "/claim/batch-recovery"
                                    : buildClaimableRecoveryPath(record.linkKey, record.title)
                              }
                            >
                              {batchRecoveryMissing ? "Batch recovery" : "Recovery"}
                            </a>
                          ) : null}
                          {deletable ? (
                            <button
                              className="btn btn-danger"
                              onClick={() => void deleteClaimableLink(record)}
                              type="button"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </details>
                  </li>
                );
                })();

              return groupedClaimables.map((group) => {
                if (!group.batch) return renderClaimableRecord(group.records[0]!);

                const automaticallyExpanded = claimableSelectionMode || claimableFiltersActive;
                const expanded =
                  automaticallyExpanded || expandedClaimableBatches.has(group.batch.batchKey);
                const claimedCount = group.records.filter(
                  (record) => record.status === "claimed",
                ).length;
                const refundableCount = group.records.filter((record) => {
                  if (isClaimableTerminal(record.status)) return false;
                  const expiry = estimateClaimableExpiry({
                    currentDaaScore: claimableDaaScore,
                    daaLoadedAtMs: claimableDaaLoadedAtMs,
                    nowMs: claimableNowMs,
                    refundLockTime: record.refundLockTime,
                  });
                  return record.status === "refundable" || expiry?.expired === true;
                }).length;
                const refundedCount = group.records.filter(
                  (record) => record.status === "refunded",
                ).length;
                const spentUnknownCount = group.records.filter(
                  (record) => record.status === "spent_unknown",
                ).length;
                const availableCount =
                  group.records.length -
                  claimedCount -
                  refundableCount -
                  refundedCount -
                  spentUnknownCount;
                const visibleLinkCount = group.records.length;
                const totalLinkCount = group.batch.linkKeys.length;
                const batchCanBeDeleted =
                  !claimableFiltersActive &&
                  group.records.length > 0 &&
                  group.records.every((record) => isClaimableTerminal(record.status));

                return (
                  <li className="claimable-batch-group" key={group.key}>
                    <details
                      className="claimable-batch-details"
                      onToggle={(event) => {
                        if (automaticallyExpanded) return;
                        const isOpen = event.currentTarget.open;
                        setExpandedClaimableBatches((current) => {
                          const next = new Set(current);
                          if (isOpen) next.add(group.batch!.batchKey);
                          else next.delete(group.batch!.batchKey);
                          return next;
                        });
                      }}
                      open={expanded}
                    >
                      <summary className="claimable-batch-summary">
                        <span className="claimable-batch-summary-copy">
                          <span className="label">Claim batch</span>
                          <strong>{group.batch.title}</strong>
                          <span className="muted">
                            {visibleLinkCount === totalLinkCount
                              ? `${totalLinkCount} links`
                              : `${visibleLinkCount} of ${totalLinkCount} matching links`}
                            {` · ${sumClaimableKas(group.records)} KAS total`}
                          </span>
                        </span>
                        <span className="claimable-batch-statuses" aria-label="Batch link status">
                          {availableCount > 0 ? <span>{availableCount} available</span> : null}
                          {claimedCount > 0 ? <span>{claimedCount} claimed</span> : null}
                          {refundableCount > 0 ? (
                            <span className="is-warning">{refundableCount} refundable</span>
                          ) : null}
                          {refundedCount > 0 ? (
                            <span className="is-refunded">{refundedCount} refunded</span>
                          ) : null}
                          {spentUnknownCount > 0 ? (
                            <span>{spentUnknownCount} spent on-chain</span>
                          ) : null}
                        </span>
                        <span className="claimable-batch-chevron" aria-hidden="true" />
                      </summary>
                      {batchCanBeDeleted ? (
                        <div className="claimable-batch-actions">
                          <span>
                            <strong>Batch complete</strong>
                            <small>All remaining links are closed.</small>
                          </span>
                          <button
                            className="btn btn-danger"
                            onClick={() => {
                              setClaimableDeleteError(null);
                              setClaimableBatchDeleteTarget({
                                batchKey: group.batch!.batchKey,
                                linkCount: totalLinkCount,
                                title: group.batch!.title,
                              });
                            }}
                            type="button"
                          >
                            Delete batch
                          </button>
                        </div>
                      ) : null}
                      <ul className="claimable-batch-links">
                        {group.records.map(renderClaimableRecord)}
                      </ul>
                    </details>
                  </li>
                );
              });
            })()}
          </ul>
          <p className="muted claimable-mylinks-note">
            The list comes from your creator account (cross-device); the claim and refund links are
            held only in this browser (non-custodial). Keep this device private — those links carry
            the secret codes.
          </p>
        </section>
      ) : null}
    </main>
  );
}
