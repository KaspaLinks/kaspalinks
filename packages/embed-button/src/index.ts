const DEFAULT_LABEL = "Pay with Kaspa";
const MAX_LABEL_LENGTH = 80;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{3,128}$/;

const THEME_STYLES = {
  dark: [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "border:1px solid #2f3743",
    "border-radius:8px",
    "background:#111827",
    "color:#f8fafc",
    "font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "padding:10px 16px",
    "text-decoration:none",
  ].join(";"),
  kaspa: [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "border:1px solid #0f8f88",
    "border-radius:8px",
    "background:#14a098",
    "color:#ffffff",
    "font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "padding:10px 16px",
    "text-decoration:none",
  ].join(";"),
  light: [
    "display:inline-flex",
    "align-items:center",
    "justify-content:center",
    "border:1px solid #cbd5e1",
    "border-radius:8px",
    "background:#ffffff",
    "color:#0f172a",
    "font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "padding:10px 16px",
    "text-decoration:none",
  ].join(";"),
} as const;

export type KaspaActionButtonTarget = "_blank" | "_self";
export type KaspaActionButtonTheme = keyof typeof THEME_STYLES | "unstyled";

export type KaspaActionButtonOptions = {
  appUrl: string;
  className?: string;
  label?: string;
  publicId: string;
  rel?: string;
  target?: KaspaActionButtonTarget;
  theme?: KaspaActionButtonTheme;
};

export function createKaspaActionUrl(input: Pick<KaspaActionButtonOptions, "appUrl" | "publicId">) {
  const appBaseUrl = normalizeAppBaseUrl(input.appUrl);
  const publicId = normalizePublicId(input.publicId);

  return `${appBaseUrl}/a/${encodeURIComponent(publicId)}`;
}

export function createKaspaActionButtonHtml(options: KaspaActionButtonOptions) {
  const publicId = normalizePublicId(options.publicId);
  const label = normalizeLabel(options.label);
  const target = normalizeTarget(options.target);
  const rel = normalizeRel(options.rel, target);
  const style = getThemeStyle(options.theme);

  const attributes: Array<[string, null | string]> = [
    ["href", createKaspaActionUrl({ appUrl: options.appUrl, publicId })],
    ["data-kaspa-action-public-id", publicId],
    ["target", target],
    ["rel", rel],
    ["class", normalizeOptionalAttribute(options.className)],
    ["style", style],
  ];

  return `<a ${attributesToHtml(attributes)}>${escapeHtml(label)}</a>`;
}

export function createKaspaActionButtonElement(
  options: KaspaActionButtonOptions,
  documentRef: Document = globalThis.document,
) {
  if (!documentRef) {
    throw new Error("A document is required to create a Kaspa Action button element.");
  }

  const publicId = normalizePublicId(options.publicId);
  const anchor = documentRef.createElement("a");
  const rel = normalizeRel(options.rel, normalizeTarget(options.target));
  const style = getThemeStyle(options.theme);

  anchor.href = createKaspaActionUrl({ appUrl: options.appUrl, publicId });
  anchor.dataset.kaspaActionPublicId = publicId;
  anchor.target = normalizeTarget(options.target);
  anchor.textContent = normalizeLabel(options.label);

  if (rel) anchor.rel = rel;
  if (style) anchor.setAttribute("style", style);
  if (options.className) anchor.className = options.className.trim();

  return anchor;
}

export function mountKaspaActionButton(
  container: Element | string,
  options: KaspaActionButtonOptions,
  documentRef: Document = globalThis.document,
) {
  if (!documentRef) {
    throw new Error("A document is required to mount a Kaspa Action button.");
  }

  const resolvedContainer =
    typeof container === "string" ? documentRef.querySelector(container) : container;

  if (!resolvedContainer) {
    throw new Error("Kaspa Action button container was not found.");
  }

  const button = createKaspaActionButtonElement(options, documentRef);
  resolvedContainer.replaceChildren(button);

  return button;
}

function attributesToHtml(attributes: Array<[string, null | string]>) {
  return attributes
    .flatMap(([name, value]) => (value === null ? [] : [`${name}="${escapeHtml(value)}"`]))
    .join(" ");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getThemeStyle(theme: KaspaActionButtonTheme = "kaspa") {
  if (theme === "unstyled") {
    return null;
  }

  const style = THEME_STYLES[theme];
  if (!style) {
    throw new Error("Kaspa Action button theme must be kaspa, dark, light, or unstyled.");
  }

  return style;
}

function normalizeAppBaseUrl(appUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("appUrl must be a valid absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("appUrl must use http or https.");
  }

  const basePath = parsed.pathname.replace(/\/+$/, "");

  return `${parsed.origin}${basePath === "/" ? "" : basePath}`;
}

function normalizeLabel(label: string | undefined) {
  const normalized = label?.trim() || DEFAULT_LABEL;

  if (normalized.length > MAX_LABEL_LENGTH) {
    throw new Error(`Button label must be ${MAX_LABEL_LENGTH} characters or fewer.`);
  }

  return normalized;
}

function normalizeOptionalAttribute(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizePublicId(publicId: string) {
  const normalized = publicId.trim();

  if (!PUBLIC_ID_PATTERN.test(normalized)) {
    throw new Error("publicId must be 3-128 URL-safe characters.");
  }

  return normalized;
}

function normalizeRel(rel: string | undefined, target: KaspaActionButtonTarget) {
  const normalized = rel?.trim();

  if (normalized) {
    return normalized;
  }

  return target === "_blank" ? "noopener noreferrer" : null;
}

function normalizeTarget(target: KaspaActionButtonTarget = "_blank") {
  if (target !== "_blank" && target !== "_self") {
    throw new Error("Button target must be _blank or _self.");
  }

  return target;
}
