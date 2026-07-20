"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { SESSION_EVENT } from "../BrandNav";
import { CreatorSignInGate } from "../CreatorSignInGate";
import { normalizeLocalizedKasAmountInput } from "@/lib/amount-input";
import { MIN_RELIABLE_MAINNET_OUTPUT_KAS } from "@/lib/mainnet-amount-policy";
import { formatApproxUsdMeta, formatApproxUsdValue } from "@/lib/price-display";
import { useKasUsdPrice } from "@/lib/use-kas-usd-price";
import { slugify, validateRecipientAddress } from "./helpers";

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

// Pencil glyph for the "Start blank" card — neutral, signals "write your own"
// instead of a specific link type.
const BLANK_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.6"
    viewBox="0 0 24 24"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
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

const LINK_TEMPLATE_BY_ID = new Map(LINK_TEMPLATES.map((template) => [template.id, template]));

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

export function NewLinkClient() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const [type, setType] = useState<ActionTypeValue>("kaspa.tip");
  const [slug, setSlug] = useState("");
  const [slugServerError, setSlugServerError] = useState<null | string>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [activeTemplateId, setActiveTemplateId] = useState<null | string>(null);
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
  const [copiedPreview, setCopiedPreview] = useState(false);
  const kasUsdPrice = useKasUsdPrice();

  const signedIn = username.length > 0 && token.length > 0;
  const selectedType = ACTION_TYPES.find((option) => option.value === type) ?? ACTION_TYPES[0]!;
  const blankTemplateActive =
    activeTemplateId === null &&
    title.trim().length === 0 &&
    description.trim().length === 0 &&
    walletNote.trim().length === 0 &&
    amountKas.trim().length === 0 &&
    !noteRequired &&
    !goalAutoClose &&
    showOnProfile === undefined;
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
  const amountUsdMeta = formatApproxUsdMeta(kasUsdPrice);

  const authHeaders = useMemo(
    () => ({
      "content-type": "application/json",
      "x-creator-token": token,
      "x-creator-username": username,
    }),
    [token, username],
  );

  const applyTemplate = useCallback((template: LinkTemplate) => {
    setActiveTemplateId(template.id);
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
    setActiveTemplateId(null);
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
    setActiveTemplateId(null);
  }, []);

  const createLink = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!signedIn) return;
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
      amountKas,
      amountMissingForRequiredType,
      authHeaders,
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

  if (!signedIn) {
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

  return (
    <main className="main-wide new-link-layout">
      <section className="card card-accent">
        <span className="label">New link</span>
        <h1 style={{ marginBottom: 6 }}>Create a Kaspa link</h1>
        <p className="muted" style={{ margin: 0 }}>
          Bundle a recipient address, an optional amount, and a short message into one shareable
          URL.
        </p>
      </section>

      <section className="card quick-template-section">
        <div>
          <span className="label">Quick start</span>
          <h2 className="form-section-heading">Start with a common use case</h2>
        </div>
        <div className="quick-template-grid" aria-label="Quick link templates">
          {LINK_TEMPLATES.map((template) => (
            <button
              aria-pressed={activeTemplateId === template.id}
              className={`quick-template-button${
                activeTemplateId === template.id ? " quick-template-button-active" : ""
              }`}
              key={template.id}
              onClick={() => applyTemplate(template)}
              type="button"
            >
              <span className="quick-template-icon" aria-hidden="true">
                {ICON_BY_TYPE.get(template.type)}
              </span>
              <span className="quick-template-title">{template.label}</span>
              <span className="quick-template-description">{template.description}</span>
              <span className="quick-template-meta">
                {humanActionType(template.type)} ·{" "}
                {template.amountKas
                  ? `${template.amountKas} KAS${template.type === "kaspa.goal" ? " target" : ""}`
                  : "Any amount"}
              </span>
            </button>
          ))}
          <Link className="quick-template-button" href="/claim/create">
            <span className="quick-template-icon" aria-hidden="true">
              {CLAIMABLE_ICON}
            </span>
            <span className="quick-template-title">Claimable reward</span>
            <span className="quick-template-description">
              Create one claimable reward or choose up to 10 separate links for a Claim Drop.
              Unclaimed KAS remains privately refundable after expiry.
            </span>
            <span className="quick-template-meta">1 to 10 links · non-custodial rewards</span>
          </Link>
          <button
            aria-pressed={blankTemplateActive}
            className={`quick-template-button quick-template-button-muted${
              blankTemplateActive ? " quick-template-button-active" : ""
            }`}
            onClick={startBlank}
            type="button"
          >
            <span className="quick-template-icon quick-template-icon-muted" aria-hidden="true">
              {BLANK_ICON}
            </span>
            <span className="quick-template-title">Start blank</span>
            <span className="quick-template-description">
              Clear the starter copy and create your own link from scratch.
            </span>
            <span className="quick-template-meta">Custom · you decide</span>
          </button>
        </div>
      </section>

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
            {amountUsdEstimate ? <p className="amount-usd-estimate">{amountUsdEstimate}</p> : null}
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
              <span className="label">Type</span>
              {/* Compact selector — the big use-case picker lives in the Quick
                  Start grid above, so here the type is just one field. Picking
                  a type directly drops any active template back to "custom". */}
              <div className="type-segmented" role="group" aria-label="Link type">
                {ACTION_TYPES.map((option) => (
                  <button
                    aria-pressed={type === option.value}
                    className={`type-segment${type === option.value ? " type-segment-active" : ""}`}
                    key={option.value}
                    onClick={() => {
                      setType(option.value);
                      setActiveTemplateId(null);
                    }}
                    type="button"
                  >
                    <span className="type-segment-icon" aria-hidden="true">
                      {option.icon}
                    </span>
                    {option.label}
                  </button>
                ))}
                <Link className="type-segment" href="/claim/create">
                  <span className="type-segment-icon" aria-hidden="true">
                    {CLAIMABLE_ICON}
                  </span>
                  Claimable
                </Link>
              </div>
              <p className="form-field-help">{selectedType.description}</p>
            </div>

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
                  type === "kaspa.tip"
                    ? "Buy me a coffee"
                    : type === "kaspa.donation"
                      ? "Support the dev"
                      : type === "kaspa.invoice"
                        ? "Invoice #2026-001"
                        : "Send 10 KAS to a friend"
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
                {isGoalType
                  ? "Goal target (KAS)"
                  : amountIsRequired
                    ? "Amount (KAS)"
                    : "Suggested amount (KAS)"}
                {!amountIsRequired && !isGoalType ? (
                  <span className="form-field-meta"> — optional</span>
                ) : null}
              </label>
              <input
                id="action-amount"
                inputMode="decimal"
                onChange={(event) => setAmountKas(event.target.value)}
                placeholder={
                  isGoalType
                    ? "e.g. 1000"
                    : amountIsRequired
                      ? "e.g. 10"
                      : "Leave blank for pay-what-you-want"
                }
                type="text"
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
              {amountUsdEstimate ? (
                <p className="form-field-help form-field-price">
                  {amountUsdMeta}: <strong>{amountUsdEstimate}</strong>
                </p>
              ) : null}
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
                  For exact goal tracking, use a fresh recipient address that is only used for this
                  goal. Reusing the same address across multiple links can make incoming payments
                  harder to attribute perfectly.
                </p>
              ) : (
                <p className="form-field-help">
                  The Kaspa wallet address that will receive payments. Always paste, never type —
                  these are not human-readable.
                </p>
              )}
            </div>
          </section>

          {/* Section 3: Public URL */}
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

          {/* Section 4: Wallet note (optional) */}
          <section className="card">
            <h2 className="form-section-heading">Wallet note (optional)</h2>
            <div className="form-field">
              <label className="label" htmlFor="action-wallet-note">
                Wallet note{" "}
                <span className="form-field-meta">— appears in the wallet next to the amount</span>
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
                    Good for commissions, custom requests, shout-outs, or anything where the payment
                    needs context (the note is off-chain, only you see it).
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
                      When on, the payment page stops creating new payment requests after confirmed
                      contributions reach the target. Existing pending requests can still confirm or
                      expire normally.
                    </span>
                  </span>
                </label>
              </div>
            ) : null}

            <div className="form-field form-toggle-field">
              <label className="form-toggle" htmlFor="action-show-on-profile">
                <input
                  checked={
                    showOnProfile === undefined
                      ? type === "kaspa.tip" || type === "kaspa.donation" || type === "kaspa.goal"
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
          </section>
        </form>

        {/* Submit lives OUTSIDE the form element so it's a third grid sibling
            (form / preview / actions). On mobile that puts the preview right
            above the Create-link button so the user reviews before tapping.
            `form="new-link-form"` keeps the button tied to the form so it
            still triggers onSubmit. */}
        <div className="new-link-actions">
          <button
            className="btn btn-primary btn-block btn-pay"
            disabled={
              submitting ||
              amountMissingForRequiredType ||
              goalMissing ||
              addressValidation.state !== "valid" ||
              normalizedSlug.length === 0 ||
              slugPreviewError !== null ||
              slugServerError !== null
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

      <section className="card card-muted">
        <p className="muted" style={{ margin: 0 }}>
          <Link href="/my-links">← Back to my links</Link>
        </p>
      </section>
    </main>
  );
}
