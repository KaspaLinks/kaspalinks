import { describe, expect, it, vi } from "vitest";

import {
  ACTIVATION_WINDOW_MS,
  buildActivationFunnel,
  classifyCreator,
  COHORT_WEEKS,
  type CreatorActivationRow,
  loadActivationFunnel,
  type PromptPageViewRow,
  startOfUtcWeek,
} from "./activation-funnel";

// Saturday, so the current UTC week started on Monday 2026-09-28.
const NOW = new Date("2026-10-03T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function creator(overrides: Partial<CreatorActivationRow> = {}): CreatorActivationRow {
  return {
    createdAt: daysAgo(20),
    firstValueAt: null,
    signupSource: null,
    username: "ada",
    ...overrides,
  };
}

function view(overrides: Partial<PromptPageViewRow> = {}): PromptPageViewRow {
  return {
    seenAt: daysAgo(1),
    status: 200,
    utmSource: "pay-success",
    visitorDayHash: "visitor-1",
    ...overrides,
  };
}

function funnel(input: {
  createProfileViews?: PromptPageViewRow[];
  creators?: CreatorActivationRow[];
  internal?: string[];
  payShareViews?: PromptPageViewRow[];
}) {
  return buildActivationFunnel({
    createProfileViews: input.createProfileViews ?? [],
    creators: input.creators ?? [],
    internalUsernames: new Set(input.internal ?? []),
    now: NOW,
    payShareViews: input.payShareViews ?? [],
  });
}

describe("startOfUtcWeek", () => {
  it("returns Monday 00:00 UTC", () => {
    expect(startOfUtcWeek(NOW).toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(startOfUtcWeek(new Date("2026-09-28T00:00:00.000Z")).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z",
    );
    // Sunday late evening still belongs to the week that started six days earlier.
    expect(startOfUtcWeek(new Date("2026-09-27T23:59:59.999Z")).toISOString()).toBe(
      "2026-09-21T00:00:00.000Z",
    );
  });
});

describe("classifyCreator", () => {
  it("activates on value landing exactly at the seven-day boundary", () => {
    const createdAt = daysAgo(20);
    const atDeadline = new Date(createdAt.getTime() + ACTIVATION_WINDOW_MS);
    const late = new Date(atDeadline.getTime() + 1);

    expect(classifyCreator(creator({ createdAt, firstValueAt: atDeadline }), NOW)).toBe(
      "activated",
    );
    expect(classifyCreator(creator({ createdAt, firstValueAt: late }), NOW)).toBe("not_activated");
  });

  it("keeps creators pending while their seven days are still running", () => {
    expect(classifyCreator(creator({ createdAt: daysAgo(3) }), NOW)).toBe("pending");
    expect(classifyCreator(creator({ createdAt: daysAgo(3), firstValueAt: daysAgo(1) }), NOW)).toBe(
      "activated",
    );
    expect(classifyCreator(creator({ createdAt: daysAgo(8) }), NOW)).toBe("not_activated");
  });
});

describe("buildActivationFunnel", () => {
  it("excludes internal creators and reports how many", () => {
    const result = funnel({
      creators: [
        creator({ firstValueAt: daysAgo(19), username: "Example" }),
        creator({ username: "ada" }),
      ],
      internal: ["example"],
    });

    expect(result.internalExcluded).toBe(1);
    expect(result.headline).toMatchObject({ activated: 0, newCreators: 1, signups: 1 });
  });

  it("counts the headline over the last 30 days only", () => {
    const result = funnel({
      creators: [
        creator({ createdAt: daysAgo(31), firstValueAt: daysAgo(30) }),
        creator({ createdAt: daysAgo(10), firstValueAt: daysAgo(9) }),
        creator({ createdAt: daysAgo(2) }),
      ],
    });

    expect(result.headline).toMatchObject({
      activated: 1,
      newCreators: 2,
      pending: 1,
      signups: 2,
    });
  });

  it("counts prompt clicks as distinct daily visitors per allowlisted label", () => {
    const result = funnel({
      createProfileViews: [
        view({ visitorDayHash: "a" }),
        view({ visitorDayHash: "a" }),
        view({ visitorDayHash: "b" }),
        view({ utmSource: "claim-success", visitorDayHash: "c" }),
        view({ utmSource: null, visitorDayHash: "d" }),
        view({ utmSource: "x", visitorDayHash: "e" }),
        view({ status: 404, visitorDayHash: "f" }),
        view({ seenAt: daysAgo(31), visitorDayHash: "g" }),
      ],
      creators: [
        creator({ createdAt: daysAgo(10), firstValueAt: daysAgo(9), signupSource: "pay-success" }),
        creator({ createdAt: daysAgo(10), signupSource: "claim-success" }),
        creator({ createdAt: daysAgo(10), signupSource: "unknown" }),
      ],
    });

    expect(result.bySource).toEqual([
      { activated: 1, clicks: 2, key: "pay-success", pending: 0, signups: 1 },
      { activated: 0, clicks: 1, key: "claim-success", pending: 0, signups: 1 },
      { activated: 0, clicks: 0, key: "other", pending: 0, signups: 1 },
    ]);
    expect(result.headline.promptClicks).toBe(3);
    expect(result.headline.promptSignups).toBe(2);
  });

  it("counts shared-page visits as distinct daily visitors", () => {
    const result = funnel({
      payShareViews: [
        view({ utmSource: "pay-share", visitorDayHash: "a" }),
        view({ utmSource: "pay-share", visitorDayHash: "a" }),
        view({ utmSource: "pay-share", visitorDayHash: "b" }),
        view({ status: 404, utmSource: "pay-share", visitorDayHash: "c" }),
      ],
    });

    expect(result.headline.payShareVisits).toBe(2);
  });

  it("groups signups into UTC Monday cohorts and leaves pending out of the rate", () => {
    const result = funnel({
      creators: [
        // Current week (open): one pending, one already activated.
        creator({ createdAt: new Date("2026-09-28T00:00:00.000Z") }),
        creator({
          createdAt: new Date("2026-09-29T10:00:00.000Z"),
          firstValueAt: new Date("2026-09-30T10:00:00.000Z"),
          signupSource: "pay-success",
        }),
        // Previous week: Sunday 23:59 UTC belongs here, not to the current week.
        creator({ createdAt: new Date("2026-09-27T23:59:59.000Z") }),
        // Two weeks back, fully decided: one activated, one not.
        creator({
          createdAt: new Date("2026-09-14T09:00:00.000Z"),
          firstValueAt: new Date("2026-09-15T09:00:00.000Z"),
        }),
        creator({ createdAt: new Date("2026-09-20T09:00:00.000Z") }),
      ],
    });

    expect(result.cohorts).toHaveLength(COHORT_WEEKS);
    const [current, previous, decided, empty] = result.cohorts;
    expect(current).toMatchObject({
      activated: 1,
      complete: false,
      pending: 1,
      rate: 1,
      signups: 2,
      viaPrompt: 1,
      weekStart: "2026-09-28T00:00:00.000Z",
    });
    expect(previous).toMatchObject({
      activated: 0,
      complete: false,
      pending: 1,
      rate: null,
      signups: 1,
      weekStart: "2026-09-21T00:00:00.000Z",
    });
    expect(decided).toMatchObject({
      activated: 1,
      complete: true,
      pending: 0,
      rate: 0.5,
      signups: 2,
      weekStart: "2026-09-14T00:00:00.000Z",
    });
    expect(empty).toMatchObject({ complete: true, rate: null, signups: 0 });
  });
});

describe("loadActivationFunnel", () => {
  it("queries on-chain value and the two page-view sets", async () => {
    const queryRaw = vi.fn(async () => [
      creator({ createdAt: daysAgo(10), firstValueAt: daysAgo(9) }),
    ]);
    const findMany = vi.fn(async () => []);

    const result = await loadActivationFunnel(
      { $queryRaw: queryRaw, operatorPageView: { findMany } } as never,
      { env: { INTERNAL_CREATOR_USERNAMES: "example" }, now: NOW },
    );

    const sql = (queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?");
    expect(sql).toContain("pr.status = 'CONFIRMED'");
    expect(sql).toContain("pr.network = 'MAINNET'");
    expect(sql).toContain(`pr."detectionSource" <> 'mock'`);
    expect(sql).toContain("cl.status = 'claimed'");
    expect(sql).toContain("cl.network = 'MAINNET'");
    expect(sql).toContain("LEAST(");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isBot: false, path: "/create-profile" }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isBot: false, utmSource: "pay-share" }),
      }),
    );
    expect(result.headline.activated).toBe(1);
  });
});
