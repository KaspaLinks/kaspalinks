export const SOCIAL_LINK_FIELDS = [
  {
    allowedHosts: null,
    key: "website",
    label: "Website",
    placeholder: "https://your-site.com",
  },
  {
    allowedHosts: ["x.com", "twitter.com"],
    key: "x",
    label: "X",
    placeholder: "https://x.com/yourname",
  },
  {
    allowedHosts: ["discord.com", "discord.gg"],
    key: "discord",
    label: "Discord",
    placeholder: "https://discord.gg/your-server",
  },
  {
    allowedHosts: ["github.com"],
    key: "github",
    label: "GitHub",
    placeholder: "https://github.com/yourname",
  },
  {
    allowedHosts: ["youtube.com", "youtu.be"],
    key: "youtube",
    label: "YouTube",
    placeholder: "https://youtube.com/@yourname",
  },
  {
    allowedHosts: ["twitch.tv"],
    key: "twitch",
    label: "Twitch",
    placeholder: "https://twitch.tv/yourname",
  },
] as const;

export type SocialLinkKey = (typeof SOCIAL_LINK_FIELDS)[number]["key"];
export type SocialLinks = Partial<Record<SocialLinkKey, string>>;

type NormalizeResult =
  | { ok: true; value: SocialLinks | null }
  | { message: string; ok: false; path?: string[] };

type NormalizeValueResult = { ok: true; value: null | string } | { message: string; ok: false };

const SOCIAL_LINK_MAX_LENGTH = 200;
const SOCIAL_LINK_KEYS = new Set<string>(SOCIAL_LINK_FIELDS.map((field) => field.key));

function fieldForKey(key: SocialLinkKey) {
  return SOCIAL_LINK_FIELDS.find((field) => field.key === key);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function hostMatchesAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const normalized = normalizeHostname(hostname);
  return allowedHosts.some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

export function normalizeSocialLinkValue(
  key: SocialLinkKey,
  rawValue: unknown,
): NormalizeValueResult {
  if (rawValue === null || rawValue === undefined) {
    return { ok: true, value: null };
  }

  if (typeof rawValue !== "string") {
    return { message: "Social link must be a URL string.", ok: false };
  }

  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }

  if (trimmed.length > SOCIAL_LINK_MAX_LENGTH) {
    return {
      message: `Social link must not exceed ${SOCIAL_LINK_MAX_LENGTH} characters.`,
      ok: false,
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { message: "Social link must be a valid HTTPS URL.", ok: false };
  }

  if (url.protocol !== "https:") {
    return { message: "Social link must use https://.", ok: false };
  }

  if (url.username || url.password) {
    return { message: "Social link must not include credentials.", ok: false };
  }

  const field = fieldForKey(key);
  if (!field) {
    return { message: "Social link platform is not supported.", ok: false };
  }

  if (field.allowedHosts !== null && !hostMatchesAllowed(url.hostname, field.allowedHosts)) {
    return {
      message: `${field.label} link must point to ${field.allowedHosts.join(" or ")}.`,
      ok: false,
    };
  }

  return { ok: true, value: url.href };
}

export function normalizeSocialLinksRecord(input: unknown): NormalizeResult {
  if (input === null || input === undefined) {
    return { ok: true, value: null };
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return { message: "Social links must be an object.", ok: false };
  }

  const source = input as Record<string, unknown>;
  const normalized: SocialLinks = {};

  for (const key of Object.keys(source)) {
    if (!SOCIAL_LINK_KEYS.has(key)) {
      return { message: "Unsupported social link platform.", ok: false, path: [key] };
    }
  }

  for (const field of SOCIAL_LINK_FIELDS) {
    const value = normalizeSocialLinkValue(field.key, source[field.key]);
    if (!value.ok) {
      return { message: value.message, ok: false, path: [field.key] };
    }
    if (value.value) {
      normalized[field.key] = value.value;
    }
  }

  return Object.keys(normalized).length > 0
    ? { ok: true, value: normalized }
    : { ok: true, value: null };
}

export function socialLinkHost(url: string): string {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return "";
  }
}

// Reserved first-path segments per platform — these look syntactically
// like usernames but are actually app sections. Without this exclusion
// list, a stray "https://x.com/search?q=foo" would render as the
// "@search" handle.
const X_RESERVED_PATHS = new Set([
  "about",
  "communities",
  "compose",
  "explore",
  "help",
  "home",
  "i",
  "intent",
  "login",
  "messages",
  "moments",
  "notifications",
  "premium",
  "privacy",
  "search",
  "settings",
  "share",
  "signup",
  "tos",
]);

const GITHUB_RESERVED_PATHS = new Set([
  "about",
  "codespaces",
  "enterprise",
  "explore",
  "features",
  "issues",
  "join",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "sponsors",
  "team",
  "topics",
  "trending",
]);

const TWITCH_RESERVED_PATHS = new Set([
  "directory",
  "downloads",
  "drops",
  "moments",
  "p",
  "prime",
  "search",
  "settings",
  "store",
  "subscriptions",
  "turbo",
  "videos",
  "wallet",
]);

/**
 * Extract a human-readable handle from a platform-specific URL.
 *
 * Returns null when:
 *   - the URL doesn't carry a handle in its structure (Discord server
 *     invite, a YouTube channel ID like UCxxx that isn't human-readable,
 *     plain Website URLs);
 *   - the first path segment matches a known reserved app section
 *     (`/search`, `/watch`, `/orgs`, …) so we don't surface a fake
 *     "@search" pill on a creator's profile;
 *   - the first segment fails the platform's own username syntax
 *     rules — strict regex per platform keeps us from rendering
 *     malformed garbage.
 *
 * The returned string already includes a leading "@" for platforms
 * that use that convention (X, YouTube modern handles) and drops it
 * for platforms that don't (GitHub, Twitch).
 */
export function extractSocialHandle(key: SocialLinkKey, rawUrl: string): null | string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first) return null;

  switch (key) {
    case "x": {
      if (X_RESERVED_PATHS.has(first.toLowerCase())) return null;
      // Twitter/X username rule: 1-15 alphanumeric or underscore.
      if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return null;
      return `@${first}`;
    }
    case "github": {
      if (GITHUB_RESERVED_PATHS.has(first.toLowerCase())) return null;
      // GitHub username rule: 1-39 chars, alphanumeric with single
      // hyphens (no leading or trailing hyphen, no consecutive hyphens).
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(first)) return null;
      return first;
    }
    case "twitch": {
      if (TWITCH_RESERVED_PATHS.has(first.toLowerCase())) return null;
      // Twitch username rule: 4-25 chars, alphanumeric + underscore.
      if (!/^[A-Za-z0-9_]{4,25}$/.test(first)) return null;
      return first;
    }
    case "youtube": {
      // Modern handle: /@handle.
      if (first.startsWith("@")) {
        const handle = first.slice(1);
        if (!/^[A-Za-z0-9._-]{3,30}$/.test(handle)) return null;
        return `@${handle}`;
      }
      // Legacy custom URL: /c/<name> and /user/<name>.
      if ((first.toLowerCase() === "c" || first.toLowerCase() === "user") && segments[1]) {
        const channel = segments[1];
        if (!/^[A-Za-z0-9._-]{1,100}$/.test(channel)) return null;
        return channel;
      }
      // /channel/UC... is a raw channel ID — opaque, skip.
      return null;
    }
    case "discord":
      // Server invites are opaque codes (`/abc123`), user IDs are
      // numeric and equally not Handle-shaped — neither reads well as
      // a pill label, so we fall back to the platform label.
      return null;
    case "website":
      // Website pills already surface the hostname; a synthetic handle
      // would clash with that representation.
      return null;
    default: {
      // Exhaustive guard — every SocialLinkKey above must be handled
      // explicitly so a new platform doesn't silently end up handle-less.
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

export function socialLinkEntries(input: unknown) {
  const normalized = normalizeSocialLinksRecord(input);
  if (!normalized.ok || normalized.value === null) {
    return [];
  }

  return SOCIAL_LINK_FIELDS.flatMap((field) => {
    const url = normalized.value?.[field.key];
    if (!url) return [];
    return [
      {
        ...field,
        handle: extractSocialHandle(field.key, url),
        host: socialLinkHost(url),
        url,
      },
    ];
  });
}
