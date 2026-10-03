import type { PrismaClient } from "@kaspa-actions/db";

import { readInternalCreatorUsernames } from "./internal-creators";
import { countsAsPageView } from "./operator-stats";
import { parseSignupSource, SIGNUP_SOURCES, type SignupSource } from "./signup-source";

// Activated Creator (docs/adr/0006): the first on-chain value — a confirmed mainnet
// payment or a claimed mainnet claimable link — lands within seven days of signup.

const DAY_MS = 24 * 60 * 60 * 1000;
export const ACTIVATION_WINDOW_MS = 7 * DAY_MS;
export const COHORT_WEEKS = 12;
export const HEADLINE_DAYS = 30;

export type CreatorActivationRow = {
  createdAt: Date;
  firstValueAt: Date | null;
  signupSource: null | string;
  username: string;
};

export type PromptPageViewRow = {
  seenAt: Date;
  status: number;
  utmSource: null | string;
  visitorDayHash: string;
};

/** A claimable link created without a KaspaLinks account (docs/adr/0007). */
export type AccountFreeLinkRow = {
  createdAt: Date;
  fundingTxId: null | string;
  source: null | string;
  status: string;
};

export type AccountFreeLinkCounts = {
  claimed: number;
  created: number;
  funded: number;
  returned: number;
};

export type ActivationState = "activated" | "not_activated" | "pending";

export type FunnelSourceKey = "other" | SignupSource;

export type FunnelCounts = {
  activated: number;
  pending: number;
  signups: number;
};

export type FunnelSourceRow = FunnelCounts & {
  /** Account-free claimable links carrying this label (30 days). */
  accountFreeLinks: number;
  clicks: number;
  key: FunnelSourceKey;
};

export type FunnelCohortRow = FunnelCounts & {
  complete: boolean;
  /** activated / (signups - pending); null while nothing has been decided. */
  rate: null | number;
  viaPrompt: number;
  weekStart: string;
};

export type ActivationFunnel = {
  accountFree: AccountFreeLinkCounts;
  bySource: FunnelSourceRow[];
  cohorts: FunnelCohortRow[];
  computedAt: string;
  headline: FunnelCounts & {
    newCreators: number;
    payShareVisits: number;
    promptClicks: number;
    promptSignups: number;
  };
  internalExcluded: number;
};

/** Monday 00:00 UTC of the week containing `date`. */
export function startOfUtcWeek(date: Date): Date {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday),
  );
}

export function classifyCreator(row: CreatorActivationRow, now: Date): ActivationState {
  const deadline = row.createdAt.getTime() + ACTIVATION_WINDOW_MS;
  if (row.firstValueAt && row.firstValueAt.getTime() <= deadline) return "activated";
  if (now.getTime() < deadline) return "pending";
  return "not_activated";
}

function emptyCounts(): FunnelCounts {
  return { activated: 0, pending: 0, signups: 0 };
}

function addTo(counts: FunnelCounts, state: ActivationState) {
  counts.signups += 1;
  if (state === "activated") counts.activated += 1;
  if (state === "pending") counts.pending += 1;
}

function sourceKey(value: null | string): FunnelSourceKey {
  return parseSignupSource(value) ?? "other";
}

function distinctVisitorDays(rows: PromptPageViewRow[]): number {
  return new Set(rows.map((row) => row.visitorDayHash)).size;
}

export function buildActivationFunnel(input: {
  accountFreeLinks?: AccountFreeLinkRow[];
  createProfileViews: PromptPageViewRow[];
  creators: CreatorActivationRow[];
  internalUsernames: ReadonlySet<string>;
  now: Date;
  payShareViews: PromptPageViewRow[];
}): ActivationFunnel {
  const { now } = input;
  const headlineSince = now.getTime() - HEADLINE_DAYS * DAY_MS;

  let internalExcluded = 0;
  const creators = input.creators.filter((row) => {
    const internal = input.internalUsernames.has(row.username.trim().toLowerCase());
    if (internal) internalExcluded += 1;
    return !internal;
  });

  // Prompt clicks: distinct daily visitors on a prompt landing page per allowlisted label.
  const viewsInWindow = input.createProfileViews.filter(
    (row) => countsAsPageView(row.status) && row.seenAt.getTime() >= headlineSince,
  );
  const clicksBySource = new Map<FunnelSourceKey, PromptPageViewRow[]>();
  for (const row of viewsInWindow) {
    const key = sourceKey(row.utmSource);
    clicksBySource.set(key, [...(clicksBySource.get(key) ?? []), row]);
  }

  const bySourceCounts = new Map<FunnelSourceKey, FunnelCounts>();
  const headline = emptyCounts();
  for (const row of creators) {
    if (row.createdAt.getTime() < headlineSince) continue;
    const state = classifyCreator(row, now);
    addTo(headline, state);
    const key = sourceKey(row.signupSource);
    const counts = bySourceCounts.get(key) ?? emptyCounts();
    addTo(counts, state);
    bySourceCounts.set(key, counts);
  }

  const recentAccountFree = (input.accountFreeLinks ?? []).filter(
    (row) => row.createdAt.getTime() >= headlineSince,
  );
  const accountFree: AccountFreeLinkCounts = {
    claimed: recentAccountFree.filter((row) => row.status === "claimed").length,
    created: recentAccountFree.length,
    funded: recentAccountFree.filter((row) => row.fundingTxId !== null).length,
    returned: recentAccountFree.filter((row) => row.status === "refunded").length,
  };

  const sourceKeys: FunnelSourceKey[] = [...SIGNUP_SOURCES, "other"];
  const bySource = sourceKeys.map((key) => ({
    ...(bySourceCounts.get(key) ?? emptyCounts()),
    accountFreeLinks: recentAccountFree.filter((row) => sourceKey(row.source) === key).length,
    clicks: key === "other" ? 0 : distinctVisitorDays(clicksBySource.get(key) ?? []),
    key,
  }));

  const currentWeek = startOfUtcWeek(now).getTime();
  const cohorts: FunnelCohortRow[] = [];
  for (let index = 0; index < COHORT_WEEKS; index += 1) {
    const weekStart = currentWeek - index * 7 * DAY_MS;
    const weekEnd = weekStart + 7 * DAY_MS;
    const counts = emptyCounts();
    let viaPrompt = 0;
    for (const row of creators) {
      const created = row.createdAt.getTime();
      if (created < weekStart || created >= weekEnd) continue;
      addTo(counts, classifyCreator(row, now));
      if (parseSignupSource(row.signupSource)) viaPrompt += 1;
    }
    const decided = counts.signups - counts.pending;
    cohorts.push({
      ...counts,
      complete: weekEnd + ACTIVATION_WINDOW_MS <= now.getTime(),
      rate: decided > 0 ? counts.activated / decided : null,
      viaPrompt,
      weekStart: new Date(weekStart).toISOString(),
    });
  }

  const promptClicks = bySource.reduce((sum, row) => sum + row.clicks, 0);
  const promptSignups = bySource
    .filter((row) => row.key !== "other")
    .reduce((sum, row) => sum + row.signups, 0);
  const payShareVisits = distinctVisitorDays(
    input.payShareViews.filter(
      (row) => countsAsPageView(row.status) && row.seenAt.getTime() >= headlineSince,
    ),
  );

  return {
    accountFree,
    bySource,
    cohorts,
    computedAt: now.toISOString(),
    headline: {
      ...headline,
      newCreators: headline.signups,
      payShareVisits,
      promptClicks,
      promptSignups,
    },
    internalExcluded,
  };
}

type FunnelPrisma = Pick<PrismaClient, "$queryRaw" | "claimableLink" | "operatorPageView">;

// Growth Prompt clicks land on signup, or directly on the account-free claim form.
const PROMPT_LANDING_PATHS = ["/create-profile", "/claim/create/single"];

export async function loadActivationFunnel(
  prisma: FunnelPrisma,
  options: { env?: Readonly<Record<string, string | undefined>>; now?: Date } = {},
): Promise<ActivationFunnel> {
  const now = options.now ?? new Date();
  const cohortSince = new Date(startOfUtcWeek(now).getTime() - (COHORT_WEEKS - 1) * 7 * DAY_MS);
  const viewsSince = new Date(now.getTime() - HEADLINE_DAYS * DAY_MS);
  const since = cohortSince < viewsSince ? cohortSince : viewsSince;

  // The earliest value ever per creator; classifyCreator decides whether it landed
  // inside the window. Mock confirmations and testnet never count. Deleted links
  // still count, because the value really moved.
  const [creators, createProfileViews, payShareViews, accountFreeLinks] = await Promise.all([
    prisma.$queryRaw<CreatorActivationRow[]>`
      WITH first_payment AS (
        SELECT a."creatorId" AS "creatorId", MIN(pr."confirmedAt") AS "firstAt"
        FROM "PaymentRequest" pr
        JOIN "Action" a ON a.id = pr."actionId"
        WHERE pr.status = 'CONFIRMED'
          AND pr.network = 'MAINNET'
          AND pr."confirmedAt" IS NOT NULL
          AND (pr."detectionSource" IS NULL OR pr."detectionSource" <> 'mock')
          AND a."creatorId" IS NOT NULL
        GROUP BY a."creatorId"
      ), first_claim AS (
        SELECT cl."creatorId" AS "creatorId", MIN(cl."claimedAt") AS "firstAt"
        FROM "ClaimableLink" cl
        WHERE cl.status = 'claimed'
          AND cl.network = 'MAINNET'
          AND cl."claimedAt" IS NOT NULL
        GROUP BY cl."creatorId"
      )
      SELECT c.username AS "username",
             c."createdAt" AS "createdAt",
             c."signupSource" AS "signupSource",
             LEAST(fp."firstAt", fc."firstAt") AS "firstValueAt"
      FROM "Creator" c
      LEFT JOIN first_payment fp ON fp."creatorId" = c.id
      LEFT JOIN first_claim fc ON fc."creatorId" = c.id
      WHERE c."createdAt" >= ${since}
    `,
    prisma.operatorPageView.findMany({
      select: { seenAt: true, status: true, utmSource: true, visitorDayHash: true },
      where: { isBot: false, path: { in: PROMPT_LANDING_PATHS }, seenAt: { gte: viewsSince } },
    }),
    prisma.operatorPageView.findMany({
      select: { seenAt: true, status: true, utmSource: true, visitorDayHash: true },
      where: { isBot: false, seenAt: { gte: viewsSince }, utmSource: "pay-share" },
    }),
    prisma.claimableLink.findMany({
      select: { createdAt: true, fundingTxId: true, source: true, status: true },
      where: { createdAt: { gte: viewsSince }, creatorId: null },
    }),
  ]);

  return buildActivationFunnel({
    accountFreeLinks,
    createProfileViews,
    creators,
    internalUsernames: readInternalCreatorUsernames(options.env),
    now,
    payShareViews,
  });
}
