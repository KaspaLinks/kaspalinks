import type { PrismaClient } from "@kaspa-actions/db";
import { describe, expect, it, vi } from "vitest";

import { actorContext } from "./actor.ts";
import {
  createGiveawaySetupDraftTool,
  listGiveawaysTool,
  readGiveawaySetupDraftTool,
} from "./giveaways.ts";

describe("Agent giveaway tools", () => {
  it("stores only public setup fields in a ten-minute creator draft", async () => {
    const create = vi.fn(async ({ data }) => ({
      ...data,
      id: "draft-1",
    }));
    const prisma = { agentIntentDraft: { create } } as unknown as PrismaClient;
    const now = new Date("2026-08-30T12:00:00.000Z");

    await createGiveawaySetupDraftTool(
      prisma,
      actorContext("creator-1", "telegram"),
      "telegram-user-1",
      {
        amountKas: "10.50000000",
        entryWindowSeconds: 86_400,
        title: "Weekend KAS",
        winnerClaimWindowSeconds: 86_400,
      },
      now,
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        creatorId: "creator-1",
        expiresAt: new Date("2026-08-30T12:10:00.000Z"),
        intent: "prepare_giveaway",
        payload: {
          amountKas: "10.5",
          entryWindowSeconds: 86_400,
          title: "Weekend KAS",
          winnerClaimWindowSeconds: 86_400,
        },
        telegramUserId: "telegram-user-1",
      },
    });
    expect(JSON.stringify(create.mock.calls[0])).not.toMatch(
      /private|secret|claimCode|refundCode/i,
    );
  });

  it("reads a draft only through the owning ActorContext", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      expiresAt: new Date("2026-08-30T12:10:00.000Z"),
      id: "draft-1",
      payload: {
        amountKas: "10",
        entryWindowSeconds: 3_600,
        title: "Test",
        winnerClaimWindowSeconds: 86_400,
      },
    });
    const prisma = { agentIntentDraft: { findFirst } } as unknown as PrismaClient;

    await readGiveawaySetupDraftTool(
      prisma,
      actorContext("creator-1", "web"),
      "draft-1",
      new Date("2026-08-30T12:00:00.000Z"),
    );

    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        creatorId: "creator-1",
        id: "draft-1",
        intent: "prepare_giveaway",
      }),
    });
  });

  it("scopes Telegram giveaway status reads to the connected creator", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { giveaway: { findMany } } as unknown as PrismaClient;

    await listGiveawaysTool(prisma, actorContext("creator-1", "telegram"));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { creatorId: "creator-1" } }),
    );
  });
});
