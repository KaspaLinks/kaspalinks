import { describe, expect, it, vi } from "vitest";

import { AgentIntentStatus, type PrismaClient } from "@kaspa-actions/db";

import { actorContext } from "./actor.ts";
import { confirmIntentDraftTool, expireAgentData, reserveAiQuota } from "./ai.ts";

describe("reserveAiQuota", () => {
  it("uses the creator timezone for daily buckets and UTC for the global month", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      estimatedCostMicros: 1_000n,
      requestCount: 1,
    });
    const tx = {
      agentQuotaBucket: { findUniqueOrThrow, updateMany, upsert },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    const reservation = await reserveAiQuota(
      prisma,
      actorContext("creator-1", "telegram"),
      "Pacific/Honolulu",
      1_000n,
      new Date("2026-09-01T00:30:00.000Z"),
    );

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ periodKey: "2026-08-31", scope: "creator-day" }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ periodKey: "2026-08", scope: "creator-month" }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ periodKey: "2026-09", scope: "global-month" }),
      }),
    );
    expect(reservation.globalPeriodKey).toBe("2026-09");
  });

  it("fails closed when the global request or cost reservation cannot be made", async () => {
    const tx = {
      agentQuotaBucket: {
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn(async ({ where }: { where: { scope: string } }) => ({
          count: where.scope === "global-month" ? 0 : 1,
        })),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      reserveAiQuota(
        prisma,
        actorContext("creator-1", "telegram"),
        "UTC",
        1_000n,
        new Date("2026-09-01T00:30:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "AI_GLOBAL_LIMIT_REACHED", status: 503 });
  });
});

describe("confirmIntentDraftTool", () => {
  it("returns the prior result for a repeated confirmation callback", async () => {
    const prisma = {
      agentIntentDraft: {
        findFirst: vi.fn().mockResolvedValue({
          resultRef: "public-action-1",
          status: AgentIntentStatus.CONFIRMED,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaClient;

    await expect(
      confirmIntentDraftTool(
        prisma,
        actorContext("creator-1", "telegram"),
        "telegram-user-1",
        "draft-1",
      ),
    ).resolves.toEqual({ alreadyConfirmed: true, resultRef: "public-action-1" });
  });
});

describe("expireAgentData", () => {
  it("expires old drafts and fails abandoned executing drafts", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
      agentIntentDraft: { updateMany },
      aiUsageEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      telegramConnectCode: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      telegramUpdate: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaClient;
    const now = new Date("2026-09-01T12:00:00.000Z");

    await expireAgentData(prisma, now);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: AgentIntentStatus.EXPIRED },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      data: { status: AgentIntentStatus.FAILED },
      where: {
        status: AgentIntentStatus.EXECUTING,
        updatedAt: { lte: new Date("2026-09-01T11:45:00.000Z") },
      },
    });
  });
});
