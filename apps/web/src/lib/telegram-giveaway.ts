import { validateTelegramMiniAppInitData, type GiveawayCardInput } from "@kaspa-actions/agent";
import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { giveawayPublicIdSchema, isGiveawayLabEnabled } from "./giveaway-lab";
import { reconcileGiveawayPrize } from "./giveaway-prize";
import { apiError, ErrorCodes } from "./errors";
import { extractClientIp, hashClientIp } from "./client-ip";
import { enforceRateLimit, RateBuckets } from "./rate-limit-helpers";

export function requireTelegramParticipant(request: Request) {
  const limit = enforceRateLimit(
    RateBuckets.AGENT_MUTATION,
    hashClientIp(extractClientIp(request.headers)),
  );
  if (!limit.allowed) return { ok: false as const, response: limit.response };
  const validation = validateTelegramMiniAppInitData(
    request.headers.get("x-telegram-mini-app-init-data") ?? "",
    process.env.TELEGRAM_BOT_TOKEN ?? "",
  );
  if (!validation.ok)
    return {
      ok: false as const,
      response: apiError(
        ErrorCodes.CREATOR_TOKEN_INVALID,
        "Reopen this giveaway in Telegram.",
        401,
      ),
    };
  const userLimit = enforceRateLimit(
    RateBuckets.AGENT_MUTATION,
    `telegram-participant:${validation.identity.userId}`,
  );
  if (!userLimit.allowed) return { ok: false as const, response: userLimit.response };
  return { ok: true as const, userId: validation.identity.userId };
}

export async function getTelegramGiveawayCard(publicId: string): Promise<GiveawayCardInput | null> {
  if (!isGiveawayLabEnabled() || !giveawayPublicIdSchema.safeParse(publicId).success) return null;
  const candidate = await prisma.giveaway.findUnique({
    where: { publicId },
    include: { prizeLink: true, creator: { select: { username: true } } },
  });
  if (!candidate) return null;
  // A share card is created from server-owned public fields after reconciliation.
  const giveaway = await reconcileGiveawayPrize(candidate);
  const prizeStatus = giveaway.prizeLink?.status;
  const unavailable = ["spent_unknown", "refunded", "claimed"].includes(prizeStatus ?? "");
  const status = unavailable
    ? prizeStatus === "spent_unknown"
      ? "Prize spend requires verification"
      : "Prize already spent"
    : giveaway.openedAt === null
      ? "Funding pending"
      : giveaway.status === "OPEN" && giveaway.closesAt.getTime() <= Date.now()
        ? "Entries closed"
        : giveaway.status;
  return {
    publicId: giveaway.publicId,
    title: giveaway.title,
    amountKas: formatSompiToKaspa(giveaway.amountSompi),
    creator: candidate.creator.username,
    closesAt: giveaway.closesAt,
    status,
    fundingConfirmed: Boolean(giveaway.prizeLink?.fundingTxId && !unavailable && giveaway.openedAt),
  };
}
