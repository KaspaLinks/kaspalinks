import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@kaspa-actions/db";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isGiveawayLabEnabled } from "@/lib/giveaway-lab";
import { finalizeGiveaway } from "@/lib/giveaway-draw";

export async function POST(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const presented = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (
    !expected ||
    !presented ||
    !timingSafeEqual(
      createHash("sha256").update(expected).digest(),
      createHash("sha256").update(presented).digest(),
    )
  ) {
    return apiError(ErrorCodes.NOT_FOUND, "Not found.", 404);
  }
  if (!isGiveawayLabEnabled())
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaways are disabled.", 403);
  const now = new Date();
  const due = await prisma.giveaway.findMany({
    where: {
      status: "OPEN",
      openedAt: { not: null },
      closesAt: { lte: now },
      telegramSubscriptions: { some: { revokedAt: null, resultQueuedAt: null } },
      OR: [
        { telegramCheckedAt: null },
        { telegramCheckedAt: { lt: new Date(now.getTime() - 30_000) } },
      ],
    },
    select: { id: true, publicId: true, telegramCheckedAt: true },
    orderBy: [{ telegramCheckedAt: { sort: "asc", nulls: "first" } }, { closesAt: "asc" }],
    take: 3,
  });
  const outcomes = await Promise.all(
    due.map(async (giveaway) => {
      const claimed = await prisma.giveaway.updateMany({
        where: { id: giveaway.id, telegramCheckedAt: giveaway.telegramCheckedAt },
        data: { telegramCheckedAt: now },
      });
      if (claimed.count !== 1) return "skipped";
      try {
        const response = await finalizeGiveaway(giveaway.publicId, "agent-worker");
        return response.ok ? "processed" : "pending";
      } catch {
        return "pending";
      }
    }),
  );
  return apiJson({
    processed: outcomes.filter((value) => value === "processed").length,
    pending: outcomes.filter((value) => value === "pending").length,
  });
}
const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as GET,
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
