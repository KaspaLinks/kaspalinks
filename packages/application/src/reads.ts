import { PaymentRequestStatus, type PrismaClient } from "@kaspa-actions/db";

import type { ActorContext } from "./actor.ts";

export async function listActionsTool(prisma: PrismaClient, actor: ActorContext, limit = 20) {
  return prisma.action.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    where: { creatorId: actor.creatorId, deletedAt: null },
  });
}

export async function listPaymentsTool(prisma: PrismaClient, actor: ActorContext, limit = 20) {
  return prisma.paymentRequest.findMany({
    include: { action: { select: { publicId: true, slug: true, title: true, type: true } } },
    orderBy: [{ confirmedAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    where: {
      action: { creatorId: actor.creatorId },
      status: PaymentRequestStatus.CONFIRMED,
    },
  });
}

export async function getCreatorStatsTool(prisma: PrismaClient, actor: ActorContext) {
  const [links, payments] = await Promise.all([
    prisma.action.count({ where: { creatorId: actor.creatorId, deletedAt: null } }),
    prisma.paymentRequest.aggregate({
      _count: { id: true },
      _sum: { amountSompi: true },
      where: {
        action: { creatorId: actor.creatorId },
        status: PaymentRequestStatus.CONFIRMED,
      },
    }),
  ]);

  return {
    confirmedPayments: payments._count.id,
    links,
    receivedSompi: payments._sum.amountSompi ?? 0n,
  };
}
