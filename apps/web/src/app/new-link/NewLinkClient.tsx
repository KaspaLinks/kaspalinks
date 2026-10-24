"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { SESSION_EVENT } from "../BrandNav";
import { CreatorSignInGate } from "../CreatorSignInGate";
import { KasAmountInput } from "../KasAmountInput";
import { useEscrowAccess } from "../escrow/_lib/use-escrow-access";
import { TurnstileWidget } from "../toccata-lab/giveaway/[publicId]/TurnstileWidget";
import {
  addAccountFreeEntry,
  buildManageUrl,
  createManageToken,
  hashManageTokenInBrowser,
} from "@/lib/account-free-store";
import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";
import { KASPA_ADDRESS_INPUT_PROPS } from "@/lib/kaspa-address-input";
import { MIN_RELIABLE_MAINNET_OUTPUT_KAS } from "@/lib/mainnet-amount-policy";
import { formatApproxUsdValue } from "@/lib/price-display";
import { parseSignupSource } from "@/lib/signup-source";
import { ACCOUNT_FREE_LINK_TURNSTILE_ACTION } from "@/lib/turnstile-shared";
import { useKasUsdPrice } from "@/lib/use-kas-usd-price";
import { AccountFreeLinkCreated, type AccountFreeCreatedLink } from "./AccountFreeLinkCreated";
import { canShowGiveawayTemplate, slugify, validateRecipientAddress } from "./helpers";
import { takeQuickRecipient } from "./quick-recipient";

type ActionTypeValue =
  | "kaspa.tip"
  | "kaspa.donation"
  | "kaspa.invoice"
  | "kaspa.transfer"
  | "kaspa.goal";

type ActionTypeDef = {
  amountRequired: boolean;
  description: string;
  // Goal/crowdfunding links collect a fundraising *target* instead of a
  // fixed per-payment amount. Supporters pay-what-you-want and the page
  // shows a progress bar. When true, the amount field is relabelled to
  // "Goal target" and its value is sent as goalKas, not amountKas.
  goalTarget: boolean;
  icon: ReactNode;
  label: string;
  value: ActionTypeValue;
};

type LinkTemplate = {
  amountKas: string;
  description: string;
  goalAutoClose: boolean;
  id: string;
  label: string;
  noteRequired: boolean;
  showOnProfile: boolean;
  title: string;
  type: ActionTypeValue;
  walletNote: string;
};

const TIP_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21l8.84-8.61a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const DONATION_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <polyline points="20 12 20 22 4 22 4 12" />
    <rect height="5" width="20" x="2" y="7" />
    <line x1="12" x2="12" y1="22" y2="7" />
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </svg>
);

const INVOICE_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <polyline points="14 3 14 9 20 9" />
    <line x1="9" x2="15" y1="14" y2="14" />
    <line x1="9" x2="15" y1="17" y2="17" />
  </svg>
);

const TRANSFER_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <line x1="5" x2="19" y1="12" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const GOAL_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const CLAIMABLE_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <rect height="12" rx="2" width="18" x="3" y="9" />
    <path d="M3 13h18M12 9v12" />
    <path d="M12 9H8.5a2.5 2.5 0 1 1 0-5C11 4 12 9 12 9Z" />
    <path d="M12 9h3.5a2.5 2.5 0 1 0 0-5C13 4 12 9 12 9Z" />
  </svg>
);

const ACTION_TYPES: ActionTypeDef[] = [
  {
    amountRequired: false,
    description: "Pay-what-you-want support. Best for creator tips.",
    goalTarget: false,
    icon: TIP_ICON,
    label: "Tip",
    value: "kaspa.tip",
  },
  {
    amountRequired: false,
    description: "Contribution to a project or cause.",
    goalTarget: false,
    icon: DONATION_ICON,
    label: "Donation",
    value: "kaspa.donation",
  },
  {
    amountRequired: true,
    description: "A specific bill — fixed KAS amount.",
    goalTarget: false,
    icon: INVOICE_ICON,
    label: "Invoice",
    value: "kaspa.invoice",
  },
  {
    amountRequired: true,
    description: "Generic one-off transfer with a fixed amount.",
    goalTarget: false,
    icon: TRANSFER_ICON,
    label: "Transfer",
    value: "kaspa.transfer",
  },
  {
    amountRequired: false,
    description: "Crowdfund toward a target. Shows a progress bar.",
    goalTarget: true,
    icon: GOAL_ICON,
    label: "Goal",
    value: "kaspa.goal",
  },
];

// Reuse each link type's existing line-icon for the Quick Start cards so the
// template grid speaks the same visual language as the Type selector below.
const ICON_BY_TYPE = new Map<ActionTypeValue, ReactNode>(
  ACTION_TYPES.map((option) => [option.value, option.icon]),
);

const LINK_TEMPLATES: LinkTemplate[] = [
  {
    amountKas: "",
    description: "Simple pay-what-you-want support for content, streams, posts, or replies.",
    goalAutoClose: false,
    id: "creator-tip",
    label: "Creator tip",
    noteRequired: false,
    showOnProfile: true,
    title: "Buy me some KAS",
    type: "kaspa.tip",
    walletNote: "Thanks for the support!",
  },
  {
    amountKas: "",
    description: "Help fund more open work, guides, community posts, or creator updates.",
    goalAutoClose: false,
    id: "support-work",
    label: "Support my work",
    noteRequired: false,
    showOnProfile: true,
    title: "Support my work",
    type: "kaspa.donation",
    walletNote: "Thanks for supporting my work!",
  },
  {
    amountKas: "100",
    description: "Contribute any amount toward this Kaspa funding goal.",
    goalAutoClose: false,
    id: "funding-goal",
    label: "Funding goal",
    noteRequired: false,
    showOnProfile: true,
    title: "Fund my next project",
    type: "kaspa.goal",
    walletNote: "Funding goal",
  },
  {
    amountKas: "10",
    description: "A fixed-amount payment request with a clear title and wallet note.",
    goalAutoClose: false,
    id: "fixed-invoice",
    label: "Fixed invoice",
    noteRequired: true,
    showOnProfile: false,
    title: "Invoice payment",
    type: "kaspa.invoice",
    walletNote: "Invoice payment",
  },
  {
    amountKas: "10",
    description: "A fixed-amount one-off transfer for testing or simple direct payments.",
    goalAutoClose: false,
    id: "simple-transfer",
    label: "Simple transfer",
    noteRequired: false,
    showOnProfile: false,
    title: "Send 10 KAS",
    type: "kaspa.transfer",
    walletNote: "Kaspa transfer",
  },
];

// Starting point for "A fixed amount": no pre-filled price, so nobody ships the
// example amount by accident.
const FIXED_PAYMENT_TEMPLATE: LinkTemplate = {
  amountKas: "",
  description: "",
  goalAutoClose: false,
  id: "fixed-payment",
  label: "Fixed amount",
  noteRequired: false,
  showOnProfile: false,
  title: "",
  type: "kaspa.transfer",
  walletNote: "",
};

const LINK_TEMPLATE_BY_ID = new Map(
  [...LINK_TEMPLATES, FIXED_PAYMENT_TEMPLATE].map((template) => [template.id, template]),
);

const TYPE_HINTS: Record<ActionTypeValue, string> = {
  "kaspa.donation": "Shown as a donation: a contribution to a project or cause.",
  "kaspa.goal": "Supporters pay what they want; a progress bar fills toward the target.",
  "kaspa.invoice": "Marked as paid after the first payment, then closed.",
  "kaspa.tip": "Shown as a tip: pay-what-you-want support.",
  "kaspa.transfer": "Can be paid more than once.",
};

// "Get paid" asks one plain question instead of five link types. Each answer
// starts from a template; the finer type (tip or donation, invoice or
// transfer) stays under More options. Each step is a real URL so the server
// logs show where people stop, without any tracking in the browser.
type PaymentKind = "any" | "fixed" | "goal";

const PAYMENT_KINDS: {
  description: string;
  kind: PaymentKind;
  label: string;
  templateId: string;
  types: ActionTypeValue[];
}[] = [
  {
    description: "Supporters choose how much. For tips and donations.",
    kind: "any",
    label: "Any amount",
    templateId: "creator-tip",
    types: ["kaspa.tip", "kaspa.donation"],
  },
  {
    description: "You set the price. For invoices, sales or a one-off payment.",
    kind: "fixed",
    label: "A fixed amount",
    templateId: "fixed-payment",
    types: ["kaspa.invoice", "kaspa.transfer"],
  },
  {
    description: "Collect any amounts toward a target, with a progress bar.",
    kind: "goal",
    label: "Toward a goal",
    templateId: "funding-goal",
    types: ["kaspa.goal"],
  },
];

function parsePaymentKind(value: null | string): PaymentKind | null {
  return PAYMENT_KINDS.find((option) => option.kind === value)?.kind ?? null;
}

function paymentKindOfType(type: ActionTypeValue): PaymentKind {
  return PAYMENT_KINDS.find((option) => option.types.includes(type))?.kind ?? "any";
}

const PAID_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <path d="M12 3v12" />
    <polyline points="7 10 12 15 17 10" />
    <path d="M5 21h14" />
  </svg>
);

const GIVEAWAY_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <rect height="5" width="18" x="3" y="8" />
    <path d="M12 8v13" />
    <path d="M19 13v8H5v-8" />
    <path d="M12 8c-1.5-3-5-3.5-5-1.5S10 8 12 8c2 0 5-0.5 5-1.5S13.5 5 12 8z" />
  </svg>
);

const TOKEN_STORAGE_KEY = "kaspa-actions:creator-token";
const USERNAME_STORAGE_KEY = "kaspa-actions:creator-username";

function readSessionValue(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function humanActionType(type: ActionTypeValue): string {
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
  }
}

function compactAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.slice(0, 14)}...${trimmed.slice(-10)}`;
}

async function writeClipboardText(value: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through */
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

export function NewLinkClient({
  accountFreeEnabled = false,
  turnstile = { required: false, siteKey: "" },
}: {
  /** Payment links can be created without a KaspaLinks account. */
  accountFreeEnabled?: boolean;
  turnstile?: { required: boolean; siteKey: string };
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [giveawayAccess, setGiveawayAccess] = useState(false);

  const [type, setType] = useState<ActionTypeValue>("kaspa.tip");
  const [slug, setSlug] = useState("");
  const [slugServerError, setSlugServerError] = useState<null | string>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [goalAutoClose, setGoalAutoClose] = useState(false);
  // Note-required flag — when true, the public pay page disables its
  // Pay button until the supporter writes a note. Server-side guard in
  // /api/actions/[publicId]/payment-requests enforces the same.
  const [noteRequired, setNoteRequired] = useState(false);
  // Public-profile visibility opt-in. We track the user's explicit choice
  // here in tri-state form: undefined = inherit the server's per-type
  // smart default (tip/donation → visible, invoice/transfer → hidden);
  // true/false = creator has clicked the toggle and we send their
  // explicit value. Avoids the "checkbox initial state hides the smart
  // default" UX bug.
  const [showOnProfile, setShowOnProfile] = useState<boolean | undefined>(undefined);
  const [amountKas, setAmountKas] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [turnstileToken, setTurnstileToken] = useState<null | string>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [accountFreeCreated, setAccountFreeCreated] = useState<AccountFreeCreatedLink | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);
  const kasUsdPrice = useKasUsdPrice();
  const escrowAccess = useEscrowAccess();

  const urlKind = parsePaymentKind(searchParams.get("kind"));
  const urlPreset = Boolean(searchParams.get("template") || searchParams.get("type"));
  const paymentStarted = searchParams.get("start") === "paid" || urlKind !== null || urlPreset;
  const paymentKind: PaymentKind | null = urlKind ?? (urlPreset ? paymentKindOfType(type) : null);
  const kindTypes = PAYMENT_KINDS.find((option) => option.kind === paymentKind)?.types ?? [];

  const signedIn = username.length > 0 && token.length > 0;
  // Without an account the link has no slug and no profile; a private manage link replaces both.
  const accountFreeMode = !signedIn && accountFreeEnabled;
  const selectedType = ACTION_TYPES.find((option) => option.value === type) ?? ACTION_TYPES[0]!;
  const amountIsRequired = selectedType.amountRequired;
  const isGoalType = selectedType.goalTarget;
  const amountMissingForRequiredType = amountIsRequired && amountKas.trim().length === 0;
  // Goal links repurpose the amount field as the fundraising target, which
  // is mandatory — a goal with no target has no progress bar to fill.
  const goalMissing = isGoalType && amountKas.trim().length === 0;
  const addressValidation = useMemo(
    () => validateRecipientAddress(recipientAddress),
    [recipientAddress],
  );

  const normalizedSlug = slug.trim().toLowerCase();
  const slugPreviewPath = username
    ? `/u/${encodeURIComponent(username)}/${normalizedSlug ? encodeURIComponent(normalizedSlug) : "your-slug"}`
    : "";
  const slugPreviewUrl =
    typeof window === "undefined" || !slugPreviewPath
      ? slugPreviewPath
      : `${window.location.origin}${slugPreviewPath}`;
  const slugPreviewError =
    normalizedSlug.length > 0 && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedSlug)
      ? "Slug contains unsupported characters."
      : null;
  const amountUsdEstimate = useMemo(
    () => formatApproxUsdValue(amountKas, kasUsdPrice),
    [amountKas, kasUsdPrice],
  );

  const authHeaders = useMemo(
    () => ({
      "content-type": "application/json",
      "x-creator-token": token,
      "x-creator-username": username,
    }),
    [token, username],
  );

  useEffect(() => {
    setGiveawayAccess(false);
    if (!signedIn) return;
    const controller = new AbortController();
    void fetch("/api/creator/giveaways/v6", {
      headers: authHeaders,
      signal: controller.signal,
    })
      .then((response) => {
        if (!controller.signal.aborted) setGiveawayAccess(response.ok);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGiveawayAccess(false);
      });
    return () => controller.abort();
  }, [signedIn, username, authHeaders]);

  const applyTemplate = useCallback((template: LinkTemplate) => {
    setType(template.type);
    setTitle(template.title);
    setDescription(template.description);
    setWalletNote(template.walletNote);
    setGoalAutoClose(template.goalAutoClose);
    setNoteRequired(template.noteRequired);
    setShowOnProfile(template.showOnProfile);
    setAmountKas(template.amountKas);
    setSlug(slugify(template.title));
    setSlugServerError(null);
    setSlugTouched(false);
    setError(null);
  }, []);

  const startBlank = useCallback(() => {
    setType("kaspa.tip");
    setTitle("");
    setDescription("");
    setWalletNote("");
    setGoalAutoClose(false);
    setNoteRequired(false);
    setShowOnProfile(undefined);
    setAmountKas("");
    setSlug("");
    setSlugServerError(null);
    setSlugTouched(false);
    setError(null);
  }, []);

  // Keeps other parameters (such as utm_source) while moving between steps.
  const goToStep = useCallback(
    (next: { kind?: PaymentKind; start?: "paid" }) => {
      const params = new URLSearchParams(window.location.search);
      params.delete("template");
      params.delete("type");
      params.delete("kind");
      params.delete("start");
      if (next.start) params.set("start", next.start);
      if (next.kind) params.set("kind", next.kind);
      const query = params.toString();
      router.push(query ? `/new-link?${query}` : "/new-link", { scroll: false });
    },
    [router],
  );

  const choosePaymentKind = useCallback(
    (kind: PaymentKind) => {
      const option = PAYMENT_KINDS.find((entry) => entry.kind === kind);
      const template = option && LINK_TEMPLATE_BY_ID.get(option.templateId);
      if (template) applyTemplate(template);
      goToStep({ kind, start: "paid" });
    },
    [applyTemplate, goToStep],
  );

  useEffect(() => {
    setUsername(readSessionValue(USERNAME_STORAGE_KEY));
    setToken(readSessionValue(TOKEN_STORAGE_KEY));
    setHydrated(true);

    // Prefer ?template=<id> for a fully pre-filled quick-start form.
    // Keep ?type=<action-type> as a narrow fallback for older links.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const templateFromUrl = LINK_TEMPLATE_BY_ID.get(params.get("template") ?? "");
      if (templateFromUrl) {
        applyTemplate(templateFromUrl);
      }

      const typeFromUrl = params.get("type");
      const validType = ACTION_TYPES.find((option) => option.value === typeFromUrl);
      if (!templateFromUrl && validType) {
        setType(validType.value);
      }

      const quickRecipient = takeQuickRecipient();
      if (quickRecipient) setRecipientAddress(quickRecipient);

      const kindFromUrl = PAYMENT_KINDS.find((option) => option.kind === params.get("kind"));
      const kindTemplate = kindFromUrl && LINK_TEMPLATE_BY_ID.get(kindFromUrl.templateId);
      if (!templateFromUrl && !validType && kindTemplate) {
        applyTemplate(kindTemplate);
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
  }, [applyTemplate]);

  // Auto-sync slug from title while the user hasn't manually edited the slug
  // field. The moment they type in the slug field, slugTouched flips to true
  // and the auto-sync stops — they're in manual mode from then on.
  useEffect(() => {
    if (!slugTouched) {
      setSlug(slugify(title));
      setSlugServerError(null);
    }
  }, [slugTouched, title]);

  const handleSlugChange = useCallback((value: string) => {
    setSlug(value);
    setSlugServerError(null);
    setSlugTouched(true);
  }, []);

  const createAccountFreeLink = useCallback(
    async (trimmedAmount: string) => {
      const manageToken = createManageToken();
      const response = await fetch("/api/actions", {
        body: JSON.stringify({
          ...(isGoalType
            ? { goalAutoClose, goalKas: trimmedAmount.length > 0 ? trimmedAmount : undefined }
            : { amountKas: trimmedAmount.length > 0 ? trimmedAmount : undefined }),
          description: description || undefined,
          manageTokenHash: await hashManageTokenInBrowser(manageToken),
          message: walletNote || undefined,
          network: "mainnet",
          noteRequired,
          recipientAddress,
          // Fixed Growth Prompt label only (allowlisted), never personal data.
          source:
            parseSignupSource(new URLSearchParams(window.location.search).get("utm_source")) ??
            undefined,
          title,
          turnstileToken: turnstileToken ?? undefined,
          type,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        // A Turnstile token is single-use; get a fresh one for the next attempt.
        setTurnstileReset((value) => value + 1);
        setError(body?.error?.message ?? "Could not create link.");
        return;
      }
      const publicId = String(body.action.publicId);
      const savedInBrowser = addAccountFreeEntry({
        createdAt: String(body.action.createdAt),
        kind: "payment",
        manageToken,
        publicId,
        title: String(body.action.title),
        type,
      });
      setAccountFreeCreated({
        manageUrl: buildManageUrl(window.location.origin, publicId, manageToken),
        savedInBrowser,
        shareUrl: `${window.location.origin}${String(body.action.sharePath)}`,
        title: String(body.action.title),
      });
      window.scrollTo({ top: 0 });
    },
    [
      description,
      goalAutoClose,
      isGoalType,
      noteRequired,
      recipientAddress,
      title,
      turnstileToken,
      type,
      walletNote,
    ],
  );

  const createLink = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!signedIn && !accountFreeMode) return;
      if (amountMissingForRequiredType) {
        setError(`${selectedType.label}s require a fixed amount.`);
        return;
      }
      if (goalMissing) {
        setError("Goals need a target amount so the progress bar has something to fill.");
        return;
      }
      setSubmitting(true);
      setError(null);
      setSlugServerError(null);

      try {
        const trimmedAmount = normalizeLocalizedKasAmountInput(amountKas.trim());
        if (accountFreeMode) {
          await createAccountFreeLink(trimmedAmount);
          return;
        }
        const response = await fetch("/api/creator/actions", {
          body: JSON.stringify({
            // Goal links send the field as goalKas (the fundraising target)
            // and leave amountKas unset so the link stays pay-what-you-want.
            // Every other type sends the field as the fixed/suggested amount.
            ...(isGoalType
              ? {
                  goalAutoClose,
                  goalKas: trimmedAmount.length > 0 ? trimmedAmount : undefined,
                }
              : { amountKas: trimmedAmount.length > 0 ? trimmedAmount : undefined }),
            description: description || undefined,
            // Translate showOnProfile -> hiddenFromProfile only if the
            // creator made an explicit choice. Leaving the field off
            // lets the server apply its per-type smart default.
            ...(showOnProfile === undefined ? {} : { hiddenFromProfile: !showOnProfile }),
            message: walletNote || undefined,
            network: "mainnet",
            noteRequired,
            recipientAddress,
            slug,
            title,
            type,
          }),
          headers: authHeaders,
          method: "POST",
        });
        const body = await response.json();

        if (!response.ok) {
          if (body?.error?.code === "SLUG_TAKEN") {
            setSlugServerError(
              body?.error?.message ?? "This public URL is already taken. Try a more specific slug.",
            );
            return;
          }
          setError(body?.error?.message ?? "Could not create link.");
          return;
        }
        router.push(`/my-links?created=${encodeURIComponent(body.action.publicId)}`);
      } catch {
        setError("Network error while creating link.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      accountFreeMode,
      amountKas,
      amountMissingForRequiredType,
      authHeaders,
      createAccountFreeLink,
      description,
      goalMissing,
      goalAutoClose,
      isGoalType,
      noteRequired,
      recipientAddress,
      router,
      showOnProfile,
      signedIn,
      slug,
      selectedType.label,
      title,
      type,
      walletNote,
    ],
  );

  const copyPreview = useCallback(async () => {
    if (!slugPreviewUrl) return;
    const ok = await writeClipboardText(slugPreviewUrl);
    if (ok) {
      setCopiedPreview(true);
      window.setTimeout(() => setCopiedPreview(false), 1600);
    }
  }, [slugPreviewUrl]);

  // Match the signed-in branch's container classes so the brand-bar
  // stays at the new-link-layout width across hydration. Without this,
  // body:has(main.new-link-layout) flips false on the first paint and
  // the brand-bar visibly shrinks → logo flashes mid-viewport for one
  // frame, then snaps back. Same root cause as DashboardClient.
  if (!hydrated) {
    return (
      <main className="main-wide new-link-layout">
        <section className="card">
          <p className="muted" style={{ margin: 0 }}>
            Loading...
          </p>
        </section>
      </main>
    );
  }

  if (!signedIn && !accountFreeMode) {
    return (
      <main className="main-wide new-link-layout">
        <CreatorSignInGate
          description="You need a creator profile to create and share links. It takes seconds — no email required."
          label="New link"
          nextPath="/new-link"
          title="Sign in to create a link"
        />
      </main>
    );
  }

  if (accountFreeCreated) {
    return (
      <main className="main-wide new-link-layout">
        <AccountFreeLinkCreated
          link={accountFreeCreated}
          onCreateAnother={() => {
            setAccountFreeCreated(null);
            setTurnstileReset((value) => value + 1);
            startBlank();
          }}
        />
      </main>
    );
  }

  const turnstileMissing = accountFreeMode && turnstile.required && !turnstileToken;

  return (
    <main className="main-wide new-link-layout">
      <section className="card card-accent">
        <span className="label">New link</span>
        <h1 style={{ marginBottom: 6 }}>Create a Kaspa link</h1>
        <p className="muted" style={{ margin: 0 }}>
          One link to get paid, send KAS or run a giveaway.
          {accountFreeMode ? " No account needed, and the KAS goes straight to your wallet." : null}
        </p>
        {accountFreeMode ? (
          <p className="muted account-free-signin-hint">
            Have an account?{" "}
            <Link href={`/sign-in?next=${encodeURIComponent("/new-link")}`}>Sign in</Link> to keep
            this link with your others.
          </p>
        ) : null}
      </section>

      <section className="card quick-template-section">
        <h2 className="form-section-heading">What do you want to do?</h2>
        <div className="quick-template-grid start-choice-grid" aria-label="What to create">
          <button
            aria-pressed={paymentStarted}
            className={`quick-template-button${paymentStarted ? " quick-template-button-active" : ""}`}
            onClick={() => goToStep({ start: "paid" })}
            type="button"
          >
            <span className="quick-template-icon" aria-hidden="true">
              {PAID_ICON}
            </span>
            <span className="quick-template-title">Get paid</span>
            <span className="quick-template-description">
              Tips, donations or a fixed price, paid straight to your wallet.
            </span>
          </button>
          <Link className="quick-template-button" href="/claim/create">
            <span className="quick-template-icon" aria-hidden="true">
              {CLAIMABLE_ICON}
            </span>
            <span className="quick-template-title">Send KAS to someone</span>
            <span className="quick-template-description">
              A link one person can claim. If nobody does, the KAS comes back to you.
            </span>
          </Link>
          {canShowGiveawayTemplate(username, giveawayAccess) && (
            <Link className="quick-template-button" href="/giveaway/new">
              <span className="quick-template-icon" aria-hidden="true">
                {GIVEAWAY_ICON}
              </span>
              <span className="quick-template-title">Run a giveaway</span>
              <span className="quick-template-description">
                Fund a prize, people join for free, and the chain draws the winner.
              </span>
            </Link>
          )}
        </div>
        {escrowAccess === "granted" ? (
          <p className="muted start-choice-extra">
            <Link href="/escrow">Escrow link (prototype)</Link>
          </p>
        ) : null}
      </section>

      {paymentStarted ? (
        <section className="card quick-template-section" id="payment-kind">
          <h2 className="form-section-heading">How should people pay?</h2>
          <div className="quick-template-grid start-choice-grid" aria-label="How people pay">
            {PAYMENT_KINDS.map((option) => (
              <button
                aria-pressed={paymentKind === option.kind}
                className={`quick-template-button${
                  paymentKind === option.kind ? " quick-template-button-active" : ""
                }`}
                key={option.kind}
                onClick={() => choosePaymentKind(option.kind)}
                type="button"
              >
                <span className="quick-template-icon" aria-hidden="true">
                  {ICON_BY_TYPE.get(option.types[0]!)}
                </span>
                <span className="quick-template-title">{option.label}</span>
                <span className="quick-template-description">{option.description}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {paymentKind ? (
        <div className="new-link-grid">
          {/* Three grid siblings: preview, form, actions. CSS `order` flips
            them on mobile so the visual flow is form → preview → button
            (so the supporter sees the preview right before tapping Create
            link). On desktop, CSS grid lifts the preview into a sticky
            right column and keeps form + button stacked on the left. The
            submit button uses `form="new-link-form"` so it can sit OUTSIDE
            the <form> element and still trigger onSubmit. */}
          {/* Live preview — updates as the user fills out the form */}
          <section className="card preview-card" aria-live="polite">
            <span className="preview-card-eyebrow">Live preview</span>
            <div className="preview-card-stage">
              <span className="link-type-pill">{humanActionType(type)}</span>
              <h3 className="preview-card-title">
                {title.trim() || <span className="preview-card-placeholder">Untitled link</span>}
              </h3>
              {description.trim() ? (
                <p className="preview-card-description">{description}</p>
              ) : (
                <p className="preview-card-description preview-card-placeholder">
                  Page description will appear here.
                </p>
              )}
              <div className="preview-card-divider" />
              <span className="label">{isGoalType ? "Goal target" : "Amount"}</span>
              <div className="amount-display amount-display-large">
                {amountKas.trim() ? (
                  <>
                    <span className="amount-main">{amountKas.trim()}</span>
                    <span className="amount-unit">KAS</span>
                  </>
                ) : (
                  <span className="amount-main preview-card-placeholder">
                    {isGoalType ? "Set a target" : "Any amount"}
                  </span>
                )}
              </div>
              {amountUsdEstimate ? (
                <p className="amount-usd-estimate">{amountUsdEstimate}</p>
              ) : null}
              <p className="preview-card-recipient">
                <span className="muted">to </span>
                <span className="value-mono">
                  {compactAddress(recipientAddress) || (
                    <span className="preview-card-placeholder">kaspa:…</span>
                  )}
                </span>
              </p>
            </div>
          </section>

          <form id="new-link-form" onSubmit={createLink} className="new-link-form">
            {/* Section 1: What is it? */}
            <section className="card">
              <h2 className="form-section-heading">What is it?</h2>

              <div className="form-field">
                <label className="label" htmlFor="action-title">
                  Title
                </label>
                <input
                  autoFocus
                  id="action-title"
                  maxLength={80}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={
                    paymentKind === "fixed"
                      ? "e.g. Logo design, Ticket, Invoice #12"
                      : paymentKind === "goal"
                        ? "e.g. New microphone for the stream"
                        : type === "kaspa.donation"
                          ? "Support the dev"
                          : "Buy me a coffee"
                  }
                  required
                  type="text"
                  value={title}
                />
              </div>

              <div className="form-field">
                <label className="label" htmlFor="action-description">
                  Page description{" "}
                  <span className="form-field-meta">— shown to supporters on the link page</span>
                </label>
                <textarea
                  id="action-description"
                  maxLength={280}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional. A short sentence so the supporter knows what they're paying for."
                  value={description}
                />
              </div>

              <div className="form-field">
                <label className="label" htmlFor="action-amount">
                  {isGoalType ? "Goal target" : amountIsRequired ? "Amount" : "Suggested amount"}
                  {!amountIsRequired && !isGoalType ? (
                    <span className="form-field-meta"> — optional</span>
                  ) : null}
                </label>
                <KasAmountInput
                  id="action-amount"
                  onChange={setAmountKas}
                  placeholder={
                    isGoalType
                      ? "e.g. 1000"
                      : amountIsRequired
                        ? "e.g. 10"
                        : "Leave blank for pay-what-you-want"
                  }
                  value={amountKas}
                />
                <p
                  className={`form-field-help${amountMissingForRequiredType || goalMissing ? " form-field-warn" : ""}`}
                >
                  {isGoalType
                    ? goalMissing
                      ? "Goals need a target so the progress bar has something to fill."
                      : "Supporters pay what they want. The progress bar fills toward this target."
                    : amountIsRequired
                      ? amountMissingForRequiredType
                        ? `${selectedType.label}s normally need a fixed amount so the supporter knows exactly what to send.`
                        : `The supporter has to match this amount exactly. Use at least ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS for reliable wallet sending.`
                      : `Leave blank to let the supporter pick. Set a value of at least ${MIN_RELIABLE_MAINNET_OUTPUT_KAS} KAS to pre-fill the wallet.`}
                </p>
              </div>
            </section>

            {/* Section 2: Where does the money go? */}
            <section className="card">
              <h2 className="form-section-heading">Where does the money go?</h2>

              <div className="form-field">
                <label className="label" htmlFor="action-recipient">
                  Recipient address
                </label>
                <div
                  className={`form-field-input-wrap${
                    addressValidation.state === "valid" ? " is-valid" : ""
                  }${addressValidation.state === "invalid" ? " is-invalid" : ""}`}
                >
                  <input
                    id="action-recipient"
                    {...KASPA_ADDRESS_INPUT_PROPS}
                    onChange={(event) => setRecipientAddress(event.target.value)}
                    placeholder="kaspa:..."
                    required
                    type="text"
                    value={recipientAddress}
                    spellCheck={false}
                  />
                  {addressValidation.state === "valid" ? (
                    <span
                      className="form-field-input-indicator form-field-input-indicator-valid"
                      aria-label="Looks like a valid Kaspa address"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                        viewBox="0 0 24 24"
                      >
                        <polyline points="5 13 10 18 19 7" />
                      </svg>
                    </span>
                  ) : null}
                  {addressValidation.state === "invalid" ? (
                    <span
                      className="form-field-input-indicator form-field-input-indicator-invalid"
                      aria-label="Address does not look valid"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                        viewBox="0 0 24 24"
                      >
                        <line x1="18" x2="6" y1="6" y2="18" />
                        <line x1="6" x2="18" y1="6" y2="18" />
                      </svg>
                    </span>
                  ) : null}
                </div>
                {addressValidation.state === "invalid" ? (
                  <p className="form-field-help form-field-warn">{addressValidation.reason}</p>
                ) : isGoalType ? (
                  <p className="form-field-help form-field-warn">
                    For exact goal tracking, use a fresh recipient address that is only used for
                    this goal. Reusing the same address across multiple links can make incoming
                    payments harder to attribute perfectly.
                  </p>
                ) : (
                  <p className="form-field-help">
                    The Kaspa wallet address that will receive payments. Always paste, never type —
                    these are not human-readable.
                  </p>
                )}
                <details className="new-link-wallet-help">
                  <summary>No Kaspa wallet yet?</summary>
                  <ol>
                    <li>
                      Install a Kaspa wallet, for example Kaspium on your phone or KasWare in your
                      browser.
                    </li>
                    <li>Open it and copy your receive address. It starts with kaspa:</li>
                    <li>Paste it here. Your link is ready to share; nobody needs your password.</li>
                  </ol>
                  <Link href="/what-is-kaspa#wallets">More about Kaspa wallets</Link>
                </details>
              </div>
            </section>

            {/* Section 3: Public URL — account-free links are served by their public id */}
            {accountFreeMode ? null : (
              <section className="card">
                <h2 className="form-section-heading">Public URL</h2>

                <div className="form-field">
                  <label className="label" htmlFor="action-slug">
                    Slug
                    {!slugTouched && slug.length > 0 ? (
                      <span className="form-field-meta"> — auto-suggested, edit to override</span>
                    ) : null}
                  </label>
                  <input
                    autoComplete="off"
                    id="action-slug"
                    onChange={(event) => handleSlugChange(event.target.value)}
                    placeholder="my-link"
                    required
                    type="text"
                    value={slug}
                  />
                  <div className="link-preview" aria-live="polite">
                    <span className="label">Preview</span>
                    <p className="value-mono link-preview-value">{slugPreviewUrl || "—"}</p>
                    {normalizedSlug && normalizedSlug !== slug.trim() ? (
                      <p className="muted" style={{ margin: 0 }}>
                        Saved as <code>{normalizedSlug}</code>.
                      </p>
                    ) : null}
                    {slugPreviewError ? (
                      <p className="error-text" style={{ margin: 0 }}>
                        {slugPreviewError}
                      </p>
                    ) : null}
                    {slugServerError ? (
                      <p className="error-text" style={{ margin: 0 }}>
                        {slugServerError}
                      </p>
                    ) : null}
                    <button
                      className="btn"
                      disabled={
                        normalizedSlug.length === 0 ||
                        slugPreviewError !== null ||
                        slugServerError !== null
                      }
                      onClick={() => void copyPreview()}
                      type="button"
                    >
                      {copiedPreview ? "Preview copied" : "Copy preview URL"}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* Section 4: optional extras, folded away so the form stays short */}
            <details className="card new-link-more">
              <summary>
                <span className="form-section-heading">More options</span>
                <span className="muted">
                  {kindTypes.length > 1 ? "Link type, " : ""}Wallet note, require a note
                  {isGoalType ? ", auto-close" : ""}
                  {accountFreeMode ? "" : ", profile"}
                  {walletNote.trim() || noteRequired ? " · set" : ""}
                </span>
              </summary>
              {kindTypes.length > 1 ? (
                <div className="form-field">
                  <span className="label">Link type</span>
                  <div className="type-segmented" role="group" aria-label="Link type">
                    {ACTION_TYPES.filter((option) => kindTypes.includes(option.value)).map(
                      (option) => (
                        <button
                          aria-pressed={type === option.value}
                          className={`type-segment${type === option.value ? " type-segment-active" : ""}`}
                          key={option.value}
                          onClick={() => {
                            setType(option.value);
                          }}
                          type="button"
                        >
                          <span className="type-segment-icon" aria-hidden="true">
                            {option.icon}
                          </span>
                          {option.label}
                        </button>
                      ),
                    )}
                  </div>
                  <p className="form-field-help">{TYPE_HINTS[type]}</p>
                </div>
              ) : null}
              <div className="form-field">
                <label className="label" htmlFor="action-wallet-note">
                  Wallet note{" "}
                  <span className="form-field-meta">
                    — appears in the wallet next to the amount
                  </span>
                </label>
                <textarea
                  id="action-wallet-note"
                  maxLength={280}
                  onChange={(event) => setWalletNote(event.target.value)}
                  placeholder='e.g. "Thanks for the support!"'
                  value={walletNote}
                />
                <p className="form-field-help">
                  This goes into the BIP-21 wallet URI and shows up as a label inside the
                  supporter&apos;s wallet. It is <strong>not</strong> written on-chain.
                </p>
              </div>

              <div className="form-field form-toggle-field">
                <label className="form-toggle" htmlFor="action-note-required">
                  <input
                    checked={noteRequired}
                    id="action-note-required"
                    onChange={(event) => setNoteRequired(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="form-toggle-body">
                    <span className="form-toggle-title">Require a note from the supporter</span>
                    <span className="form-toggle-help">
                      Pay button stays disabled until the supporter writes at least 10 characters.
                      Good for commissions, custom requests, shout-outs, or anything where the
                      payment needs context (the note is off-chain, only you see it).
                    </span>
                  </span>
                </label>
              </div>

              {isGoalType ? (
                <div className="form-field form-toggle-field">
                  <label className="form-toggle" htmlFor="action-goal-auto-close">
                    <input
                      checked={goalAutoClose}
                      id="action-goal-auto-close"
                      onChange={(event) => setGoalAutoClose(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="form-toggle-body">
                      <span className="form-toggle-title">Auto-close when the goal is reached</span>
                      <span className="form-toggle-help">
                        When on, the payment page stops creating new payment requests after
                        confirmed contributions reach the target. Existing pending requests can
                        still confirm or expire normally.
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}

              {accountFreeMode ? null : (
                <div className="form-field form-toggle-field">
                  <label className="form-toggle" htmlFor="action-show-on-profile">
                    <input
                      checked={
                        showOnProfile === undefined
                          ? type === "kaspa.tip" ||
                            type === "kaspa.donation" ||
                            type === "kaspa.goal"
                          : showOnProfile
                      }
                      id="action-show-on-profile"
                      onChange={(event) => setShowOnProfile(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="form-toggle-body">
                      <span className="form-toggle-title">Show on my public profile</span>
                      <span className="form-toggle-help">
                        When on, this link appears in the list at{" "}
                        <code>/u/{username || "your-username"}</code>. Tips and donations are on by
                        default; invoices and transfers are off by default since they often contain
                        customer-specific details.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </details>
          </form>

          {/* Submit lives OUTSIDE the form element so it's a third grid sibling
            (form / preview / actions). On mobile that puts the preview right
            above the Create-link button so the user reviews before tapping.
            `form="new-link-form"` keeps the button tied to the form so it
            still triggers onSubmit. */}
          <div className="new-link-actions">
            {accountFreeMode && turnstile.required ? (
              <TurnstileWidget
                action={ACCOUNT_FREE_LINK_TURNSTILE_ACTION}
                onError={() =>
                  setError("Human verification did not finish yet. It retries on its own.")
                }
                onToken={(value) => {
                  setTurnstileToken(value);
                  if (value) setError(null);
                }}
                resetKey={turnstileReset}
                siteKey={turnstile.siteKey}
              />
            ) : null}
            <button
              className="btn btn-primary btn-block btn-pay"
              disabled={
                submitting ||
                amountMissingForRequiredType ||
                goalMissing ||
                addressValidation.state !== "valid" ||
                turnstileMissing ||
                (!accountFreeMode &&
                  (normalizedSlug.length === 0 ||
                    slugPreviewError !== null ||
                    slugServerError !== null))
              }
              form="new-link-form"
              type="submit"
            >
              {submitting ? "Creating..." : "Create link"}
            </button>
            {error ? (
              <p className="error-text" style={{ marginTop: 8 }}>
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <section className="card card-muted">
        <p className="muted" style={{ margin: 0 }}>
          <Link href="/my-links">
            {accountFreeMode ? "Links created in this browser →" : "← Back to my links"}
          </Link>
        </p>
      </section>
    </main>
  );
}
