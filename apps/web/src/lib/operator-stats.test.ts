import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildOperatorStatsFromStoredPageViews,
  buildOperatorStatsFromText,
  loadPersistentOperatorStatsFromAccessLogs,
  parseCaddyAccessLogLines,
  syncOperatorPageViewsFromAccessLogs,
} from "./operator-stats";

const NOW = new Date("2026-05-19T12:00:00.000Z");
const CHROME_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SAFARI_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function line(input: {
  country?: string;
  host?: string;
  ip?: string;
  method?: string;
  referer?: string;
  remoteIp?: string;
  status?: number;
  ts?: string;
  uri: string;
  userAgent?: string;
}) {
  const clientIp = input.ip ?? "203.0.113.10";
  return JSON.stringify({
    request: {
      client_ip: clientIp,
      headers: {
        "CF-Connecting-IP": [clientIp],
        "CF-IPCountry": input.country ? [input.country] : undefined,
        Referer: input.referer ? [input.referer] : undefined,
        "User-Agent": [input.userAgent ?? CHROME_DESKTOP],
      },
      host: input.host ?? "kaspalinks.com",
      method: input.method ?? "GET",
      remote_ip: input.remoteIp ?? (input.country ? "173.245.48.10" : clientIp),
      uri: input.uri,
    },
    status: input.status ?? 200,
    ts: input.ts ?? "2026-05-19T11:00:00.000Z",
  });
}

describe("operator stats", () => {
  it("counts human page views while filtering API and static assets", () => {
    const stats = buildOperatorStatsFromText(
      [
        line({ country: "DE", uri: "/" }),
        line({ country: "DE", uri: "/_next/static/app.js" }),
        line({ country: "DE", uri: "/api/health" }),
        line({ country: "DE", method: "POST", uri: "/new-link" }),
      ].join("\n"),
      { filesRead: 1, now: NOW },
    );

    expect(stats.pageViews.human).toBe(1);
    expect(stats.pages).toEqual([{ count: 1, label: "/" }]);
    expect(stats.source.linesParsed).toBe(4);
  });

  it("ignores scanner probes and redirect hops so one sweep cannot look like traffic", () => {
    const stats = buildOperatorStatsFromText(
      [
        line({ country: "DE", uri: "/" }),
        // Scanner probes: paths that do not exist here, answered with 404.
        line({ country: "NL", status: 404, uri: "/stripe.env" }),
        line({ country: "NL", status: 404, uri: "/s3/bucket" }),
        line({ country: "NL", status: 404, uri: "/wp-admin/install.php" }),
        // The http→https hop of a real visit; the 200 above already counted it.
        line({ country: "DE", status: 308, uri: "/" }),
        // A cached revisit is still a visit.
        line({ country: "DE", status: 304, uri: "/faq" }),
      ].join("\n"),
      { filesRead: 1, now: NOW },
    );

    expect(stats.pageViews.human).toBe(2);
    expect(stats.pages).toEqual([
      { count: 1, label: "/" },
      { count: 1, label: "/faq" },
    ]);
  });

  it("normalizes referrers, UTM sources, devices, browsers, and countries", () => {
    const stats = buildOperatorStatsFromText(
      [
        line({
          country: "US",
          referer: "https://t.co/abc",
          uri: "/u/creator/tip?utm_source=x",
          userAgent: SAFARI_MOBILE,
        }),
        line({
          country: "DE",
          referer: "https://kaspalinks.com/stats",
          uri: "/deck",
          userAgent: CHROME_DESKTOP,
        }),
      ].join("\n"),
      { filesRead: 1, now: NOW },
    );

    expect(stats.referrers).toContainEqual({ count: 1, label: "X / Twitter" });
    expect(stats.referrers).toContainEqual({ count: 1, label: "Internal" });
    expect(stats.utmSources).toEqual([{ count: 1, label: "x" }]);
    expect(stats.devices).toContainEqual({ count: 1, label: "Mobile" });
    expect(stats.browsers).toContainEqual({ count: 1, label: "Safari" });
    expect(stats.countries.map((country) => country.code).sort()).toEqual(["DE", "US"]);
  });

  it("ignores country headers on direct-origin requests", () => {
    const stats = buildOperatorStatsFromText(
      line({
        country: "DE",
        ip: "198.51.100.42",
        remoteIp: "198.51.100.42",
        uri: "/",
      }),
      { filesRead: 1, now: NOW },
    );

    expect(stats.pageViews.human).toBe(1);
    expect(stats.countries).toEqual([]);
    expect(stats.countryUnknownViews).toBe(1);
  });

  it("keeps bots out of human visitor metrics", () => {
    const stats = buildOperatorStatsFromText(
      [
        line({ uri: "/", userAgent: "Twitterbot/1.0" }),
        line({ uri: "/roadmap", userAgent: CHROME_DESKTOP }),
      ].join("\n"),
      { filesRead: 1, now: NOW },
    );

    expect(stats.bots.hits).toBe(1);
    expect(stats.pageViews.human).toBe(1);
    expect(stats.pages).toEqual([{ count: 1, label: "/roadmap" }]);
  });

  it("keeps 24h, 7d, and total page-view windows distinct", () => {
    const stats = buildOperatorStatsFromText(
      [
        line({ ts: "2026-05-19T11:00:00.000Z", uri: "/" }),
        line({ ts: "2026-05-17T12:00:00.000Z", uri: "/roadmap" }),
        line({ ts: "2026-05-09T12:00:00.000Z", uri: "/deck" }),
      ].join("\n"),
      { filesRead: 1, now: NOW },
    );

    expect(stats.pageViews.last24h).toBe(1);
    expect(stats.pageViews.last7d).toBe(2);
    expect(stats.pageViews.human).toBe(3);
    expect(stats.source.earliestSeenAt).toBe("2026-05-09T12:00:00.000Z");
    expect(stats.source.latestSeenAt).toBe("2026-05-19T11:00:00.000Z");
  });

  it("discounts stored scanner probes and redirect hops recorded before they were filtered", () => {
    const stats = buildOperatorStatsFromStoredPageViews(
      [
        {
          browser: "Chrome",
          countryCode: "DE",
          device: "Desktop",
          isBot: false,
          path: "/",
          referrer: "Direct / unknown",
          seenAt: new Date("2026-05-19T11:00:00.000Z"),
          status: 200,
          utmSource: null,
          visitorDayHash: "visitor-2026-05-19",
        },
        {
          browser: "Firefox",
          countryCode: "NL",
          device: "Desktop",
          isBot: false,
          path: "/stripe.env",
          referrer: "Direct / unknown",
          seenAt: new Date("2026-05-19T11:00:00.000Z"),
          status: 404,
          utmSource: null,
          visitorDayHash: "scanner-2026-05-19",
        },
        {
          browser: "Chrome",
          countryCode: "DE",
          device: "Desktop",
          isBot: false,
          path: "/",
          referrer: "Direct / unknown",
          seenAt: new Date("2026-05-19T11:00:00.000Z"),
          status: 308,
          utmSource: null,
          visitorDayHash: "visitor-2026-05-19",
        },
      ],
      { filesRead: 1, now: NOW },
    );

    expect(stats.pageViews.human).toBe(1);
    expect(stats.uniqueVisitors.approximate).toBe(1);
    // The raw rows stay available for the status breakdown.
    expect(stats.source.linesParsed).toBe(3);
  });

  it("builds stable totals from persisted page views instead of only readable log tails", () => {
    const stats = buildOperatorStatsFromStoredPageViews(
      [
        {
          browser: "Chrome",
          countryCode: "DE",
          device: "Desktop",
          isBot: false,
          path: "/",
          referrer: "Direct / unknown",
          seenAt: new Date("2026-05-19T11:00:00.000Z"),
          status: 200,
          utmSource: null,
          visitorDayHash: "visitor-2026-05-19",
        },
        {
          browser: "Safari",
          countryCode: "US",
          device: "Mobile",
          isBot: false,
          path: "/deck",
          referrer: "Telegram",
          seenAt: new Date("2026-05-17T12:00:00.000Z"),
          status: 200,
          utmSource: "telegram",
          visitorDayHash: "visitor-2026-05-17",
        },
        {
          browser: "Chrome",
          countryCode: "DE",
          device: "Desktop",
          isBot: false,
          path: "/roadmap",
          referrer: "Direct / unknown",
          seenAt: new Date("2026-05-09T12:00:00.000Z"),
          status: 200,
          utmSource: null,
          visitorDayHash: "visitor-2026-05-09",
        },
      ],
      { filesRead: 2, now: NOW },
    );

    expect(stats.pageViews.last24h).toBe(1);
    expect(stats.pageViews.last7d).toBe(2);
    expect(stats.pageViews.human).toBe(3);
    expect(stats.uniqueVisitors.approximate).toBe(3);
    expect(stats.source.linesParsed).toBe(3);
  });

  it("does not expose raw IP addresses in the aggregate stats object", () => {
    const stats = buildOperatorStatsFromText(line({ ip: "198.51.100.42", uri: "/" }), {
      filesRead: 1,
      now: NOW,
    });

    expect(JSON.stringify(stats)).not.toContain("198.51.100.42");
    expect(stats.uniqueVisitors.approximate).toBe(1);
  });

  it("tracks parse errors without failing the whole dashboard", () => {
    const parsed = parseCaddyAccessLogLines(["not json", line({ uri: "/" })].join("\n"));

    expect(parsed.parseErrors).toBe(1);
    expect(parsed.entries).toHaveLength(1);
  });

  it("reads rotated logs that Caddy already compressed", async () => {
    // Caddy rolls at 20 MiB and gzips what it rolls. Skipping .gz meant every
    // day older than the current roll could never be imported at all.
    const logDir = await mkdtemp(path.join(tmpdir(), "kaspa-operator-logs-"));
    try {
      await writeFile(path.join(logDir, "kaspa-access.log"), line({ uri: "/today" }));
      await writeFile(
        path.join(logDir, "kaspa-access-2026-05-18T00-00-00.000-size.log.gz"),
        gzipSync(Buffer.from(line({ ts: "2026-05-18T11:00:00.000Z", uri: "/rolled-away" }))),
      );

      const createMany = vi.fn().mockResolvedValue({ count: 2 });
      const prisma = {
        operatorPageView: { createMany },
      } as unknown as Parameters<typeof syncOperatorPageViewsFromAccessLogs>[0];

      const result = await syncOperatorPageViewsFromAccessLogs(prisma, { logDir });

      expect(result).toMatchObject({ filesRead: 2, linesParsed: 2 });
      const paths = createMany.mock.calls.flatMap((call) =>
        (call[0].data as Array<{ path: string }>).map((row) => row.path),
      );
      expect(paths).toContain("/rolled-away");
      expect(paths).toContain("/today");
    } finally {
      await rm(logDir, { force: true, recursive: true });
    }
  });

  it("reads a log far past the old two-megabyte tail window", async () => {
    // The reader used to take only the last two megabytes of a file. Anything
    // written between two imports beyond that window was lost for good.
    const logDir = await mkdtemp(path.join(tmpdir(), "kaspa-operator-logs-"));
    try {
      // Each line is roughly 330 bytes, so this puts the first line about two
      // megabytes beyond the tail the reader used to take.
      const filler = Array.from({ length: 12_000 }, (_unused, index) =>
        line({ uri: `/filler-${index}` }),
      );
      await writeFile(
        path.join(logDir, "kaspa-access.log"),
        [line({ uri: "/oldest-line" }), ...filler].join("\n"),
      );

      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        operatorPageView: { createMany },
      } as unknown as Parameters<typeof syncOperatorPageViewsFromAccessLogs>[0];

      const result = await syncOperatorPageViewsFromAccessLogs(prisma, { logDir });

      expect(result.linesParsed).toBe(12_001);
      const paths = createMany.mock.calls.flatMap((call) =>
        (call[0].data as Array<{ path: string }>).map((row) => row.path),
      );
      expect(paths).toContain("/oldest-line");
    } finally {
      await rm(logDir, { force: true, recursive: true });
    }
  });

  it("re-reads every retained log so an earlier gap fills itself in", async () => {
    // A single high-water mark cannot describe a history with holes in it, so
    // the import deliberately re-reads and lets the unique index absorb the
    // repeats. Anything the retention window still holds gets recovered.
    const logDir = await mkdtemp(path.join(tmpdir(), "kaspa-operator-logs-"));
    try {
      await writeFile(
        path.join(logDir, "kaspa-access.log"),
        [
          line({ ts: "2026-05-19T10:00:00.000Z", uri: "/missed-that-day" }),
          line({ ts: "2026-05-19T11:30:00.000Z", uri: "/recorded-already" }),
        ].join("\n"),
      );

      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        operatorPageView: { createMany },
      } as unknown as Parameters<typeof syncOperatorPageViewsFromAccessLogs>[0];

      const result = await syncOperatorPageViewsFromAccessLogs(prisma, { logDir });

      expect(result.linesParsed).toBe(2);
      const paths = createMany.mock.calls.flatMap((call) =>
        (call[0].data as Array<{ path: string }>).map((row) => row.path),
      );
      expect(paths).toEqual(["/missed-that-day", "/recorded-already"]);
      expect(createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    } finally {
      await rm(logDir, { force: true, recursive: true });
    }
  });

  it("syncs page views to persistence without storing raw IP addresses", async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), "kaspa-operator-logs-"));
    try {
      await writeFile(path.join(logDir, "kaspa-access.log"), line({ uri: "/u/ada/tip" }));
      const createMany = vi.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        operatorPageView: { createMany },
      } as unknown as Parameters<typeof syncOperatorPageViewsFromAccessLogs>[0];

      const result = await syncOperatorPageViewsFromAccessLogs(prisma, { logDir });

      expect(result).toMatchObject({
        filesRead: 1,
        linesParsed: 1,
        storage: "database",
      });
      expect(createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            path: "/u/ada/tip",
            visitorDayHash: expect.any(String),
          }),
        ],
        skipDuplicates: true,
      });
      expect(JSON.stringify(createMany.mock.calls)).not.toContain("203.0.113.10");
    } finally {
      await rm(logDir, { force: true, recursive: true });
    }
  });

  it("falls back to the logs when page views cannot be stored", async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), "kaspa-operator-logs-"));
    try {
      await writeFile(
        path.join(logDir, "kaspa-access.log"),
        [line({ uri: "/u/ada/tip" }), "not json"].join("\n"),
      );
      const prisma = {
        operatorPageView: { createMany: vi.fn().mockRejectedValue(new Error("db down")) },
      } as unknown as Parameters<typeof syncOperatorPageViewsFromAccessLogs>[0];

      const result = await syncOperatorPageViewsFromAccessLogs(prisma, { logDir });

      expect(result).toMatchObject({
        filesRead: 1,
        linesParsed: 1,
        parseErrors: 1,
        storage: "logs",
      });
    } finally {
      await rm(logDir, { force: true, recursive: true });
    }
  });

  it("still shows log-based stats on the operator page when the database fails", async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), "kaspa-operator-logs-"));
    try {
      await writeFile(path.join(logDir, "kaspa-access.log"), line({ uri: "/u/ada/tip" }));
      const prisma = {
        operatorPageView: { createMany: vi.fn().mockRejectedValue(new Error("db down")) },
      } as unknown as Parameters<typeof loadPersistentOperatorStatsFromAccessLogs>[0];

      const stats = await loadPersistentOperatorStatsFromAccessLogs(prisma, { logDir, now: NOW });

      expect(stats.source).toMatchObject({ filesRead: 1, storage: "logs" });
      expect(stats.parseErrors).toBe(0);
      expect(stats.pageViews.human).toBe(1);
    } finally {
      await rm(logDir, { force: true, recursive: true });
    }
  });
});
