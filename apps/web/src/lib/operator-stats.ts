import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Prisma, PrismaClient } from "@kaspa-actions/db";

const DEFAULT_LOG_DIR = "/var/log/caddy";
const LOG_FILE_PREFIX = "kaspa-access";
const MAX_LOG_FILES = 12;
const MAX_BYTES_PER_FILE = 2_000_000;
const CREATE_MANY_BATCH_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_VIEW_SYNC_CACHE_MS = 30_000;

const STATIC_PATH_PREFIXES = [
  "/_next/",
  "/api/",
  "/brand/",
  "/favicon",
  "/icon",
  "/apple-icon",
  "/opengraph-image",
];

const STATIC_FILE_RE =
  /\.(?:avif|css|gif|ico|jpeg|jpg|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;

const BOT_UA_RE =
  /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|discordbot|telegrambot|whatsapp|preview|crawler|uptime|monitor|headless/i;

const COUNTRY_POINTS: Record<string, { lat: number; lon: number; name: string }> = {
  AR: { lat: -34.6, lon: -58.4, name: "Argentina" },
  AT: { lat: 48.2, lon: 16.4, name: "Austria" },
  AU: { lat: -33.9, lon: 151.2, name: "Australia" },
  BE: { lat: 50.8, lon: 4.4, name: "Belgium" },
  BR: { lat: -15.8, lon: -47.9, name: "Brazil" },
  CA: { lat: 45.4, lon: -75.7, name: "Canada" },
  CH: { lat: 46.9, lon: 7.4, name: "Switzerland" },
  CN: { lat: 39.9, lon: 116.4, name: "China" },
  CZ: { lat: 50.1, lon: 14.4, name: "Czechia" },
  DE: { lat: 52.5, lon: 13.4, name: "Germany" },
  DK: { lat: 55.7, lon: 12.6, name: "Denmark" },
  ES: { lat: 40.4, lon: -3.7, name: "Spain" },
  FI: { lat: 60.2, lon: 24.9, name: "Finland" },
  FR: { lat: 48.9, lon: 2.4, name: "France" },
  GB: { lat: 51.5, lon: -0.1, name: "United Kingdom" },
  GR: { lat: 38, lon: 23.7, name: "Greece" },
  HK: { lat: 22.3, lon: 114.2, name: "Hong Kong" },
  ID: { lat: -6.2, lon: 106.8, name: "Indonesia" },
  IE: { lat: 53.3, lon: -6.3, name: "Ireland" },
  IN: { lat: 28.6, lon: 77.2, name: "India" },
  IT: { lat: 41.9, lon: 12.5, name: "Italy" },
  JP: { lat: 35.7, lon: 139.7, name: "Japan" },
  KR: { lat: 37.6, lon: 127, name: "South Korea" },
  MX: { lat: 19.4, lon: -99.1, name: "Mexico" },
  NL: { lat: 52.4, lon: 4.9, name: "Netherlands" },
  NO: { lat: 59.9, lon: 10.8, name: "Norway" },
  NZ: { lat: -41.3, lon: 174.8, name: "New Zealand" },
  PL: { lat: 52.2, lon: 21, name: "Poland" },
  PT: { lat: 38.7, lon: -9.1, name: "Portugal" },
  RO: { lat: 44.4, lon: 26.1, name: "Romania" },
  RU: { lat: 55.8, lon: 37.6, name: "Russia" },
  SE: { lat: 59.3, lon: 18.1, name: "Sweden" },
  SG: { lat: 1.3, lon: 103.8, name: "Singapore" },
  TH: { lat: 13.8, lon: 100.5, name: "Thailand" },
  TR: { lat: 41, lon: 28.9, name: "Turkey" },
  UA: { lat: 50.5, lon: 30.5, name: "Ukraine" },
  US: { lat: 39.8, lon: -98.6, name: "United States" },
  ZA: { lat: -26.2, lon: 28, name: "South Africa" },
};

export type AccessLogEntry = {
  browser: string;
  countryCode: null | string;
  device: "Bot" | "Desktop" | "Mobile" | "Tablet";
  host: string;
  ipHash: string;
  isBot: boolean;
  isPageView: boolean;
  method: string;
  path: string;
  referrer: string;
  status: number;
  timestamp: Date;
  uri: string;
  utmSource: null | string;
};

export type RankedMetric = {
  count: number;
  label: string;
};

export type CountryMetric = {
  code: string;
  count: number;
  lat: number;
  lon: number;
  name: string;
  x: number;
  y: number;
};

export type OperatorStats = {
  bots: {
    hits: number;
  };
  browsers: RankedMetric[];
  computedAt: string;
  countries: CountryMetric[];
  countryUnknownViews: number;
  devices: RankedMetric[];
  pageViews: {
    human: number;
    last24h: number;
    last30d: number;
    last7d: number;
  };
  pages: RankedMetric[];
  parseErrors: number;
  referrers: RankedMetric[];
  source: {
    earliestSeenAt: null | string;
    filesRead: number;
    latestSeenAt: null | string;
    linesParsed: number;
    logDir: string;
    storage: "database" | "logs";
  };
  statusCodes: RankedMetric[];
  uniqueVisitors: {
    approximate: number;
    last7d: number;
  };
  utmSources: RankedMetric[];
};

export type OperatorPageViewSyncResult = {
  filesRead: number;
  linesParsed: number;
  logDir: string;
  parseErrors: number;
  storage: "database" | "logs";
};

type RawLogRead = {
  filesRead: number;
  logDir: string;
  text: string;
};

type ParsedLine = {
  entry: AccessLogEntry | null;
  ok: boolean;
};

type StoredPageViewRow = {
  browser: string;
  countryCode: null | string;
  device: string;
  isBot: boolean;
  path: string;
  referrer: string;
  seenAt: Date;
  status: number;
  utmSource: null | string;
  visitorDayHash: string;
};

type CaddyLogRecord = {
  request?: {
    client_ip?: unknown;
    headers?: Record<string, unknown>;
    host?: unknown;
    method?: unknown;
    remote_ip?: unknown;
    uri?: unknown;
  };
  status?: unknown;
  ts?: unknown;
};

let pageViewSyncCache: {
  completedAtMs: number;
  key: string;
  result: OperatorPageViewSyncResult;
} | null = null;

export async function loadOperatorStatsFromAccessLogs(options?: {
  logDir?: string;
  now?: Date;
}): Promise<OperatorStats> {
  const logDir = options?.logDir ?? process.env.OPERATOR_ACCESS_LOG_DIR ?? DEFAULT_LOG_DIR;
  const read = await readRecentAccessLogText(logDir);

  return buildOperatorStatsFromText(read.text, {
    filesRead: read.filesRead,
    logDir: read.logDir,
    now: options?.now,
  });
}

export async function loadPersistentOperatorStatsFromAccessLogs(
  prisma: PrismaClient,
  options?: {
    logDir?: string;
    now?: Date;
  },
): Promise<OperatorStats> {
  const logDir = options?.logDir ?? process.env.OPERATOR_ACCESS_LOG_DIR ?? DEFAULT_LOG_DIR;
  const read = await readRecentAccessLogText(logDir);
  const parsed = parseCaddyAccessLogLines(read.text);

  try {
    await persistOperatorPageViews(prisma, parsed.entries);
    const rows = await prisma.operatorPageView.findMany({
      select: {
        browser: true,
        countryCode: true,
        device: true,
        isBot: true,
        path: true,
        referrer: true,
        seenAt: true,
        status: true,
        utmSource: true,
        visitorDayHash: true,
      },
    });

    return buildOperatorStatsFromStoredPageViews(rows, {
      filesRead: read.filesRead,
      logDir: read.logDir,
      now: options?.now,
      parseErrors: parsed.parseErrors,
    });
  } catch {
    return buildOperatorStats(parsed.entries, {
      filesRead: read.filesRead,
      logDir: read.logDir,
      now: options?.now,
      parseErrors: parsed.parseErrors,
    });
  }
}

export async function syncOperatorPageViewsFromAccessLogs(
  prisma: PrismaClient,
  options?: {
    logDir?: string;
  },
): Promise<OperatorPageViewSyncResult> {
  const logDir = options?.logDir ?? process.env.OPERATOR_ACCESS_LOG_DIR ?? DEFAULT_LOG_DIR;
  const cacheKey = logDir;
  const nowMs = Date.now();
  if (
    pageViewSyncCache &&
    pageViewSyncCache.key === cacheKey &&
    nowMs - pageViewSyncCache.completedAtMs < PAGE_VIEW_SYNC_CACHE_MS
  ) {
    return pageViewSyncCache.result;
  }

  const read = await readRecentAccessLogText(logDir);
  const parsed = parseCaddyAccessLogLines(read.text);

  let result: OperatorPageViewSyncResult;
  try {
    await persistOperatorPageViews(prisma, parsed.entries);
    result = {
      filesRead: read.filesRead,
      linesParsed: parsed.entries.length,
      logDir: read.logDir,
      parseErrors: parsed.parseErrors,
      storage: "database",
    };
  } catch {
    result = {
      filesRead: read.filesRead,
      linesParsed: parsed.entries.length,
      logDir: read.logDir,
      parseErrors: parsed.parseErrors,
      storage: "logs",
    };
  }

  pageViewSyncCache = {
    completedAtMs: Date.now(),
    key: cacheKey,
    result,
  };
  return result;
}

export function buildOperatorStatsFromText(
  text: string,
  options?: {
    filesRead?: number;
    logDir?: string;
    now?: Date;
  },
): OperatorStats {
  const parsed = parseCaddyAccessLogLines(text);

  return buildOperatorStats(parsed.entries, {
    filesRead: options?.filesRead ?? 0,
    logDir: options?.logDir ?? DEFAULT_LOG_DIR,
    now: options?.now,
    parseErrors: parsed.parseErrors,
  });
}

export function parseCaddyAccessLogLines(text: string): {
  entries: AccessLogEntry[];
  parseErrors: number;
} {
  const entries: AccessLogEntry[] = [];
  let parseErrors = 0;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = parseCaddyAccessLogLine(trimmed);
    if (!parsed.ok) {
      parseErrors += 1;
      continue;
    }
    if (parsed.entry) {
      entries.push(parsed.entry);
    }
  }

  return { entries, parseErrors };
}

export function buildOperatorStats(
  entries: AccessLogEntry[],
  options?: {
    filesRead?: number;
    logDir?: string;
    now?: Date;
    parseErrors?: number;
  },
): OperatorStats {
  const now = options?.now ?? new Date();
  const cutoff24h = now.getTime() - DAY_MS;
  const cutoff7d = now.getTime() - 7 * DAY_MS;
  const cutoff30d = now.getTime() - 30 * DAY_MS;
  const pageViews = entries.filter((entry) => entry.isPageView);
  const humanPageViews = pageViews.filter((entry) => !entry.isBot);
  const humanPageViews7d = humanPageViews.filter((entry) => entry.timestamp.getTime() >= cutoff7d);
  const uniqueAll = new Set<string>();
  const unique7d = new Set<string>();
  let earliestSeenAt: Date | null = null;
  let latestSeenAt: Date | null = null;

  for (const entry of humanPageViews) {
    uniqueAll.add(`${entry.ipHash}:${dateBucket(entry.timestamp)}`);
    if (entry.timestamp.getTime() >= cutoff7d) {
      unique7d.add(`${entry.ipHash}:${dateBucket(entry.timestamp)}`);
    }
    if (!earliestSeenAt || entry.timestamp < earliestSeenAt) {
      earliestSeenAt = entry.timestamp;
    }
    if (!latestSeenAt || entry.timestamp > latestSeenAt) {
      latestSeenAt = entry.timestamp;
    }
  }

  const countryCounts = countBy(
    humanPageViews.flatMap((entry) => (entry.countryCode ? [entry.countryCode] : [])),
  );
  const countries = Object.entries(countryCounts)
    .flatMap(([code, count]) => {
      const point = COUNTRY_POINTS[code];
      if (!point) return [];
      const { x, y } = projectCountryPoint(point.lat, point.lon);
      return [{ code, count, lat: point.lat, lon: point.lon, name: point.name, x, y }];
    })
    .sort((a, b) => b.count - a.count);

  const countryKnownViews = countries.reduce((total, country) => total + country.count, 0);

  return {
    bots: {
      hits: entries.filter((entry) => entry.isBot).length,
    },
    browsers: ranked(countBy(humanPageViews.map((entry) => entry.browser))),
    computedAt: now.toISOString(),
    countries,
    countryUnknownViews: Math.max(0, humanPageViews.length - countryKnownViews),
    devices: ranked(countBy(humanPageViews.map((entry) => entry.device))),
    pageViews: {
      human: humanPageViews.length,
      last24h: humanPageViews.filter((entry) => entry.timestamp.getTime() >= cutoff24h).length,
      last30d: humanPageViews.filter((entry) => entry.timestamp.getTime() >= cutoff30d).length,
      last7d: humanPageViews7d.length,
    },
    pages: ranked(countBy(humanPageViews.map((entry) => entry.path)), 12),
    parseErrors: options?.parseErrors ?? 0,
    referrers: ranked(countBy(humanPageViews.map((entry) => entry.referrer)), 10),
    source: {
      earliestSeenAt: earliestSeenAt?.toISOString() ?? null,
      filesRead: options?.filesRead ?? 0,
      latestSeenAt: latestSeenAt?.toISOString() ?? null,
      linesParsed: entries.length,
      logDir: options?.logDir ?? DEFAULT_LOG_DIR,
      storage: "logs",
    },
    statusCodes: ranked(countBy(pageViews.map((entry) => String(entry.status))), 8),
    uniqueVisitors: {
      approximate: uniqueAll.size,
      last7d: unique7d.size,
    },
    utmSources: ranked(
      countBy(humanPageViews.flatMap((entry) => (entry.utmSource ? [entry.utmSource] : []))),
      10,
    ),
  };
}

export function buildOperatorStatsFromStoredPageViews(
  rows: StoredPageViewRow[],
  options?: {
    filesRead?: number;
    logDir?: string;
    now?: Date;
    parseErrors?: number;
  },
): OperatorStats {
  const now = options?.now ?? new Date();
  const cutoff24h = now.getTime() - DAY_MS;
  const cutoff7d = now.getTime() - 7 * DAY_MS;
  const cutoff30d = now.getTime() - 30 * DAY_MS;
  const humanPageViews = rows.filter((row) => !row.isBot);
  const humanPageViews7d = humanPageViews.filter((row) => row.seenAt.getTime() >= cutoff7d);
  const uniqueAll = new Set<string>();
  const unique7d = new Set<string>();
  let earliestSeenAt: Date | null = null;
  let latestSeenAt: Date | null = null;

  for (const row of humanPageViews) {
    uniqueAll.add(row.visitorDayHash);
    if (row.seenAt.getTime() >= cutoff7d) {
      unique7d.add(row.visitorDayHash);
    }
    if (!earliestSeenAt || row.seenAt < earliestSeenAt) {
      earliestSeenAt = row.seenAt;
    }
    if (!latestSeenAt || row.seenAt > latestSeenAt) {
      latestSeenAt = row.seenAt;
    }
  }

  const countryCounts = countBy(
    humanPageViews.flatMap((row) => (row.countryCode ? [row.countryCode] : [])),
  );
  const countries = Object.entries(countryCounts)
    .flatMap(([code, count]) => {
      const point = COUNTRY_POINTS[code];
      if (!point) return [];
      const { x, y } = projectCountryPoint(point.lat, point.lon);
      return [{ code, count, lat: point.lat, lon: point.lon, name: point.name, x, y }];
    })
    .sort((a, b) => b.count - a.count);
  const countryKnownViews = countries.reduce((total, country) => total + country.count, 0);

  return {
    bots: {
      hits: rows.filter((row) => row.isBot).length,
    },
    browsers: ranked(countBy(humanPageViews.map((row) => row.browser))),
    computedAt: now.toISOString(),
    countries,
    countryUnknownViews: Math.max(0, humanPageViews.length - countryKnownViews),
    devices: ranked(countBy(humanPageViews.map((row) => row.device))),
    pageViews: {
      human: humanPageViews.length,
      last24h: humanPageViews.filter((row) => row.seenAt.getTime() >= cutoff24h).length,
      last30d: humanPageViews.filter((row) => row.seenAt.getTime() >= cutoff30d).length,
      last7d: humanPageViews7d.length,
    },
    pages: ranked(countBy(humanPageViews.map((row) => row.path)), 12),
    parseErrors: options?.parseErrors ?? 0,
    referrers: ranked(countBy(humanPageViews.map((row) => row.referrer)), 10),
    source: {
      earliestSeenAt: earliestSeenAt?.toISOString() ?? null,
      filesRead: options?.filesRead ?? 0,
      latestSeenAt: latestSeenAt?.toISOString() ?? null,
      linesParsed: rows.length,
      logDir: options?.logDir ?? DEFAULT_LOG_DIR,
      storage: "database",
    },
    statusCodes: ranked(countBy(rows.map((row) => String(row.status))), 8),
    uniqueVisitors: {
      approximate: uniqueAll.size,
      last7d: unique7d.size,
    },
    utmSources: ranked(
      countBy(humanPageViews.flatMap((row) => (row.utmSource ? [row.utmSource] : []))),
      10,
    ),
  };
}

async function persistOperatorPageViews(
  prisma: PrismaClient,
  entries: AccessLogEntry[],
): Promise<void> {
  const data = entries
    .filter((entry) => entry.isPageView)
    .map((entry): Prisma.OperatorPageViewCreateManyInput => {
      const eventHash = createHash("sha256")
        .update(
          [
            "operator-page-view",
            entry.timestamp.toISOString(),
            entry.method,
            entry.host,
            entry.uri,
            String(entry.status),
            entry.ipHash,
          ].join("|"),
        )
        .digest("hex");
      const visitorDayHash = createHash("sha256")
        .update(["operator-visitor-day", dateBucket(entry.timestamp), entry.ipHash].join("|"))
        .digest("hex")
        .slice(0, 32);

      return {
        browser: entry.browser,
        countryCode: entry.countryCode,
        device: entry.device,
        eventHash,
        isBot: entry.isBot,
        path: entry.path,
        referrer: entry.referrer,
        seenAt: entry.timestamp,
        status: entry.status,
        utmSource: entry.utmSource,
        visitorDayHash,
      };
    });

  for (let index = 0; index < data.length; index += CREATE_MANY_BATCH_SIZE) {
    const chunk = data.slice(index, index + CREATE_MANY_BATCH_SIZE);
    if (chunk.length === 0) continue;
    await prisma.operatorPageView.createMany({
      data: chunk,
      skipDuplicates: true,
    });
  }
}

async function readRecentAccessLogText(logDir: string): Promise<RawLogRead> {
  let names: string[];
  try {
    names = await readdir(logDir);
  } catch {
    return { filesRead: 0, logDir, text: "" };
  }

  const files = (
    await Promise.all(
      names
        .filter((name) => name.startsWith(LOG_FILE_PREFIX) && !name.endsWith(".gz"))
        .map(async (name) => {
          const fullPath = path.join(logDir, name);
          try {
            const info = await stat(fullPath);
            if (!info.isFile()) return null;
            return { fullPath, mtime: info.mtimeMs, size: info.size };
          } catch {
            return null;
          }
        }),
    )
  )
    .filter((file): file is { fullPath: string; mtime: number; size: number } => file !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_LOG_FILES);

  const chunks: string[] = [];

  for (const file of files) {
    const length = Math.min(file.size, MAX_BYTES_PER_FILE);
    const start = Math.max(0, file.size - length);
    const buffer = Buffer.alloc(length);
    let handle;
    try {
      handle = await open(file.fullPath, "r");
      await handle.read(buffer, 0, length, start);
      chunks.push(buffer.toString("utf8"));
    } catch {
      continue;
    } finally {
      await handle?.close();
    }
  }

  return {
    filesRead: files.length,
    logDir,
    text: chunks.reverse().join("\n"),
  };
}

function parseCaddyAccessLogLine(line: string): ParsedLine {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    return { entry: null, ok: false };
  }

  if (!isObject(json)) {
    return { entry: null, ok: false };
  }

  const record = json as CaddyLogRecord;
  const request = record.request;
  if (!isObject(request)) {
    return { entry: null, ok: false };
  }

  const timestamp = parseTimestamp(record.ts);
  const uri = stringValue(request.uri);
  const method = stringValue(request.method)?.toUpperCase() ?? "";
  if (!timestamp || !uri || !method) {
    return { entry: null, ok: false };
  }

  const headers = isObject(request.headers) ? request.headers : {};
  const host = stringValue(request.host) ?? "unknown";
  const ua = headerValue(headers, "User-Agent") ?? "";
  const status = numberValue(record.status) ?? 0;
  const parsedUrl = parseRequestUrl(uri, host);
  const clientIp = stringValue(request.client_ip);
  const remoteIp = stringValue(request.remote_ip);
  const ip = clientIp ?? remoteIp ?? "unknown";
  const trustedProxy = Boolean(clientIp && remoteIp && clientIp !== remoteIp);
  const isBot = BOT_UA_RE.test(ua);
  const pathName = parsedUrl?.pathname ?? uri.split("?")[0] ?? "/";
  const utmSource = sanitizeMetricLabel(parsedUrl?.searchParams.get("utm_source") ?? null);

  return {
    entry: {
      browser: detectBrowser(ua),
      countryCode: detectCountry(headers, trustedProxy),
      device: detectDevice(ua),
      host,
      ipHash: createHash("sha256").update(`${ip}:${ua}`).digest("hex").slice(0, 24),
      isBot,
      isPageView: isPageView({ method, pathName, status }),
      method,
      path: pathName,
      referrer: normalizeReferrer(headerValue(headers, "Referer"), host),
      status,
      timestamp,
      uri,
      utmSource,
    },
    ok: true,
  };
}

function isPageView({
  method,
  pathName,
  status,
}: {
  method: string;
  pathName: string;
  status: number;
}): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (status >= 500) return false;
  if (STATIC_PATH_PREFIXES.some((prefix) => pathName.startsWith(prefix))) return false;
  if (STATIC_FILE_RE.test(pathName)) return false;
  return true;
}

function parseTimestamp(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function parseRequestUrl(uri: string, host: string): URL | null {
  try {
    return new URL(uri, `https://${host || "kaspalinks.local"}`);
  } catch {
    return null;
  }
}

function detectDevice(userAgent: string): AccessLogEntry["device"] {
  if (!userAgent || BOT_UA_RE.test(userAgent)) return "Bot";
  if (/ipad|tablet|kindle|silk/i.test(userAgent)) return "Tablet";
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return "Mobile";
  return "Desktop";
}

function detectBrowser(userAgent: string): string {
  if (!userAgent || BOT_UA_RE.test(userAgent)) return "Bot";
  if (/SamsungBrowser/i.test(userAgent)) return "Samsung Internet";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/CriOS|Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent)) return "Chrome";
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return "Safari";
  return "Other";
}

function detectCountry(headers: Record<string, unknown>, trustedProxy: boolean): null | string {
  if (!trustedProxy) return null;

  const value =
    headerValue(headers, "CF-IPCountry") ??
    headerValue(headers, "X-Country-Code") ??
    headerValue(headers, "X-Vercel-IP-Country") ??
    headerValue(headers, "CloudFront-Viewer-Country");

  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "ZZ") return null;
  return code;
}

function normalizeReferrer(referrer: null | string, requestHost: string): string {
  if (!referrer) return "Direct / unknown";

  try {
    const url = new URL(referrer);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const ownHost = requestHost.replace(/^www\./, "").toLowerCase();

    if (host === ownHost) return "Internal";
    if (host === "t.co" || host === "x.com" || host === "twitter.com") return "X / Twitter";
    if (host.endsWith(".twitter.com") || host.endsWith(".x.com")) return "X / Twitter";
    if (host.includes("discord.")) return "Discord";
    if (host.includes("telegram.") || host === "t.me") return "Telegram";
    if (host.includes("reddit.")) return "Reddit";
    if (host.includes("facebook.") || host === "fb.me") return "Facebook";
    if (host.includes("youtube.") || host === "youtu.be") return "YouTube";
    if (host.includes("google.")) return "Google";
    if (host.includes("linkedin.")) return "LinkedIn";
    return host;
  } catch {
    return "Direct / unknown";
  }
}

function projectCountryPoint(lat: number, lon: number): { x: number; y: number } {
  return {
    x: clamp(((lon + 180) / 360) * 100, 4, 96),
    y: clamp(((90 - lat) / 180) * 100, 8, 92),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = sanitizeMetricLabel(value) ?? "Unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function ranked(counts: Record<string, number>, limit = 8): RankedMetric[] {
  return Object.entries(counts)
    .map(([label, count]) => ({ count, label }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function headerValue(headers: Record<string, unknown>, wanted: string): null | string {
  const key = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === wanted.toLowerCase(),
  );
  if (!key) return null;

  const value = headers[key];
  if (Array.isArray(value)) {
    return stringValue(value[0]);
  }
  return stringValue(value);
}

function stringValue(value: unknown): null | string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numberValue(value: unknown): null | number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function sanitizeMetricLabel(value: null | string): null | string {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

function dateBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
