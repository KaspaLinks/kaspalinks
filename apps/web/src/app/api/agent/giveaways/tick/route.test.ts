import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), updateMany: vi.fn(), finalize: vi.fn() }));
vi.mock("@kaspa-actions/db", () => ({
  prisma: { giveaway: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock("@/lib/giveaway-draw", () => ({ finalizeGiveaway: mocks.finalize }));
import { POST } from "./route";
function req(secret = "worker-secret") {
  return new Request("http://app:3000/api/agent/giveaways/tick", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": secret },
  });
}
describe("Scheduled subscribed giveaway draws", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = "worker-secret";
    process.env.TOCCATA_LAB_ENABLED = "true";
    process.env.GIVEAWAY_LAB_ENABLED = "true";
    mocks.findMany.mockResolvedValue([{ id: "db1", publicId: "g1", telegramCheckedAt: null }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.finalize.mockResolvedValue(new Response("{}"));
  });
  it("rejects unauthenticated scheduling before DB work", async () => {
    expect((await POST(req("wrong"))).status).toBe(404);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("uses the shared draw rules and scans only due subscribed giveaways", async () => {
    expect((await POST(req())).status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        where: expect.objectContaining({
          status: "OPEN",
          openedAt: { not: null },
          closesAt: { lte: expect.any(Date) },
          telegramSubscriptions: { some: { revokedAt: null, resultQueuedAt: null } },
        }),
      }),
    );
    expect(mocks.finalize).toHaveBeenCalledWith("g1", "agent-worker");
  });
  it("skips work claimed by another worker", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await POST(req());
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("leaves unavailable chain data pending for the next bounded retry", async () => {
    mocks.finalize.mockRejectedValue(new Error("indexer unavailable"));
    expect(await (await POST(req())).json()).toMatchObject({ pending: 1 });
  });
});
