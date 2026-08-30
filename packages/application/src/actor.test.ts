import type { PrismaClient } from "@kaspa-actions/db";
import { describe, expect, it, vi } from "vitest";

import { actorContext } from "./actor.ts";
import { getCreatorStatsTool, listActionsTool, listPaymentsTool } from "./reads.ts";

describe("ActorContext ownership", () => {
  it("requires an authenticated creator id", () => {
    expect(() => actorContext("  ", "telegram")).toThrow("authenticated creatorId");
    expect(actorContext(" creator-1 ", "web")).toEqual({
      channel: "web",
      creatorId: "creator-1",
    });
  });

  it("scopes every read tool to the server-provided creator", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const paymentFindMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const aggregate = vi.fn().mockResolvedValue({ _count: { id: 0 }, _sum: { amountSompi: null } });
    const prisma = {
      action: { count, findMany },
      paymentRequest: { aggregate, findMany: paymentFindMany },
    } as unknown as PrismaClient;
    const actor = actorContext("creator-1", "telegram");

    await listActionsTool(prisma, actor);
    await listPaymentsTool(prisma, actor);
    await getCreatorStatsTool(prisma, actor);

    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ where: { creatorId: "creator-1" } });
    expect(paymentFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { action: { creatorId: "creator-1" } },
    });
    expect(count.mock.calls[0]?.[0]).toMatchObject({ where: { creatorId: "creator-1" } });
    expect(aggregate.mock.calls[0]?.[0]).toMatchObject({
      where: { action: { creatorId: "creator-1" } },
    });
  });
});
