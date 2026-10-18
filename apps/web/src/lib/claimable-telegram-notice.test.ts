import { describe, expect, it, vi } from "vitest";

import { Prisma } from "@kaspa-actions/db";

import { queueClaimableTelegramNotice } from "./claimable-telegram-notice";

const TX = "a".repeat(64);

function prismaWith(link: unknown, create = vi.fn(async () => ({}))) {
  return {
    client: {
      claimableLink: { findUnique: vi.fn(async () => link) },
      telegramOutbox: { create },
    } as unknown as Parameters<typeof queueClaimableTelegramNotice>[0],
    create,
  };
}

const owned = {
  amountSompi: 500_200_000n,
  creator: { telegramConnection: { blockedAt: null, id: "connection-1" } },
  creatorId: "creator-tg",
  feeSompi: 200_000n,
  title: "Coffee for Ada",
};

describe("queueClaimableTelegramNotice", () => {
  it("queues one message with the amount the recipient receives", async () => {
    const { client, create } = prismaWith(owned);

    await queueClaimableTelegramNotice(client, {
      kind: "claimed",
      linkId: "link-1",
      transactionId: TX,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        connectionId: "connection-1",
        creatorId: "creator-tg",
        dedupeKey: "telegram:claimable:claimed:link-1",
        kind: "claimable.status",
        payload: {
          amountSompi: "500000000",
          explorerUrl: `https://kaspa.stream/transactions/${TX}`,
          status: "claimed",
          title: "Coffee for Ada",
        },
      },
    });
  });

  it("sends nothing for links without a Telegram chat or a blocked one", async () => {
    for (const link of [
      null,
      { ...owned, creator: null },
      { ...owned, creator: { telegramConnection: null } },
      { ...owned, creator: { telegramConnection: { blockedAt: new Date(), id: "c" } } },
    ]) {
      const { client, create } = prismaWith(link);
      await queueClaimableTelegramNotice(client, {
        kind: "returned",
        linkId: "link-1",
        transactionId: TX,
      });
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("treats a repeated claim or return as already queued", async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
      clientVersion: "test",
      code: "P2002",
    });
    const { client } = prismaWith(
      owned,
      vi.fn(async () => {
        throw duplicate;
      }),
    );

    await expect(
      queueClaimableTelegramNotice(client, {
        kind: "returned",
        linkId: "link-1",
        transactionId: TX,
      }),
    ).resolves.toBeUndefined();
  });
});
