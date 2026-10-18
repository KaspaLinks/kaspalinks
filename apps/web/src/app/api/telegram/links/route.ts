import { ActionType, PaymentRequestStatus, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { requireCreator } from "@/lib/creator-guard";
import { apiJson, apiMethodNotAllowed } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { telegramActionPath } from "@/lib/telegram-links";

// "My links" in the Telegram Mini App: the chat workspace's payment links and
// claim links. Claim codes never reach the server, so claim links are listed
// with their state only; the link itself lives in the browser that made it.

const PUBLIC_TYPE: Record<ActionType, string> = {
  [ActionType.KASPA_DONATION]: "kaspa.donation",
  [ActionType.KASPA_GOAL]: "kaspa.goal",
  [ActionType.KASPA_INVOICE]: "kaspa.invoice",
  [ActionType.KASPA_TIP]: "kaspa.tip",
  [ActionType.KASPA_TRANSFER]: "kaspa.transfer",
};

function kas(value: bigint | null): null | string {
  return value !== null && value > 0n ? formatSompiToKaspa(value) : null;
}

export async function GET(request: Request) {
  const guard = await requireCreator(request, prisma, {
    allowTelegramMiniApp: true,
    allowTelegramOnly: true,
  });
  if (!guard.ok) return guard.response;
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_FUNDING_STATUS, guard.creator.id);
  if (!limited.allowed) return limited.response;

  const [actions, claims, connection] = await Promise.all([
    prisma.action.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        amountSompi: true,
        createdAt: true,
        disabledAt: true,
        goalSompi: true,
        id: true,
        publicId: true,
        slug: true,
        title: true,
        type: true,
      },
      take: 20,
      where: { creatorId: guard.creator.id, deletedAt: null },
    }),
    prisma.claimableLink.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        amountSompi: true,
        createdAt: true,
        feeSompi: true,
        linkKey: true,
        status: true,
        title: true,
      },
      take: 20,
      where: { creatorId: guard.creator.id, deletedAt: null },
    }),
    prisma.telegramConnection.findUnique({
      select: { notificationsEnabled: true },
      where: { creatorId: guard.creator.id },
    }),
  ]);
  const totals = actions.length
    ? await prisma.paymentRequest.groupBy({
        _count: { _all: true },
        _sum: { amountSompi: true },
        by: ["actionId"],
        where: {
          actionId: { in: actions.map((action) => action.id) },
          status: PaymentRequestStatus.CONFIRMED,
        },
      })
    : [];
  const totalByAction = new Map(totals.map((row) => [row.actionId, row]));
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://kaspalinks.com").replace(/\/$/, "");

  return apiJson({
    alertsEnabled: connection?.notificationsEnabled === true,
    claimLinks: claims.map((claim) => ({
      amountKas: kas(claim.amountSompi - claim.feeSompi) ?? kas(claim.amountSompi),
      createdAt: claim.createdAt.toISOString(),
      linkKey: claim.linkKey,
      status: claim.status,
      title: claim.title,
    })),
    paymentLinks: actions.map((action) => {
      const total = totalByAction.get(action.id);
      return {
        amountKas: kas(action.amountSompi),
        confirmedCount: total?._count._all ?? 0,
        createdAt: action.createdAt.toISOString(),
        disabled: action.disabledAt !== null,
        goalKas: kas(action.goalSompi),
        publicId: action.publicId,
        receivedKas: kas(total?._sum.amountSompi ?? null) ?? "0",
        title: action.title,
        type: PUBLIC_TYPE[action.type],
        url: `${appUrl}${telegramActionPath(guard.creator, action)}`,
      };
    }),
    wallet: guard.creator.defaultRecipientAddress,
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
