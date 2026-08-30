import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@kaspa-actions/db";

import { setAgentAccessTool } from "./agent-settings.ts";

describe("setAgentAccessTool", () => {
  it("revokes connection codes and the active connection when beta access is removed", async () => {
    const tx = {
      creator: {
        update: vi.fn().mockResolvedValue({
          agentAiEnabled: false,
          telegramBetaEnabled: false,
          username: "alice",
        }),
      },
      telegramConnectCode: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      telegramConnection: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    await setAgentAccessTool(prisma, "creator-1", { telegramBetaEnabled: false });

    expect(tx.telegramConnectCode.deleteMany).toHaveBeenCalledWith({
      where: { creatorId: "creator-1" },
    });
    expect(tx.telegramConnection.deleteMany).toHaveBeenCalledWith({
      where: { creatorId: "creator-1" },
    });
  });

  it("keeps an existing connection when only AI access changes", async () => {
    const tx = {
      creator: {
        update: vi.fn().mockResolvedValue({
          agentAiEnabled: true,
          telegramBetaEnabled: true,
          username: "alice",
        }),
      },
      telegramConnectCode: { deleteMany: vi.fn() },
      telegramConnection: { deleteMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    await setAgentAccessTool(prisma, "creator-1", { aiEnabled: true });

    expect(tx.telegramConnectCode.deleteMany).not.toHaveBeenCalled();
    expect(tx.telegramConnection.deleteMany).not.toHaveBeenCalled();
  });
});
