import { Prisma, type PrismaClient } from "@kaspa-actions/db";

// Tells the creator in Telegram when one of their claim links was claimed or
// returned. Only links owned by a creator with a Telegram chat get a message;
// the dedupe key keeps a retried claim or return from sending it twice.

export type ClaimableTelegramNotice = "claimed" | "returned";

export async function queueClaimableTelegramNotice(
  prisma: Pick<PrismaClient, "claimableLink" | "telegramOutbox">,
  input: { kind: ClaimableTelegramNotice; linkId: string; transactionId: string },
): Promise<void> {
  const link = await prisma.claimableLink.findUnique({
    select: {
      amountSompi: true,
      creator: { select: { telegramConnection: { select: { blockedAt: true, id: true } } } },
      creatorId: true,
      feeSompi: true,
      title: true,
    },
    where: { id: input.linkId },
  });
  const connection = link?.creator?.telegramConnection;
  if (!link || !connection || connection.blockedAt) return;

  const netSompi = link.amountSompi - link.feeSompi;
  try {
    await prisma.telegramOutbox.create({
      data: {
        connectionId: connection.id,
        creatorId: link.creatorId,
        dedupeKey: `telegram:claimable:${input.kind}:${input.linkId}`,
        kind: "claimable.status",
        payload: {
          amountSompi: (netSompi > 0n ? netSompi : link.amountSompi).toString(),
          explorerUrl: `https://kaspa.stream/transactions/${input.transactionId}`,
          status: input.kind,
          title: link.title,
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}
