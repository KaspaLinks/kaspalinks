import type { Prisma, PrismaClient } from "@kaspa-actions/db";

/**
 * Marks a Telegram chat as active for the usage stats. Best effort: a failed
 * write must never fail the command or Mini App request that triggered it.
 */
export async function touchTelegramActivity(
  prisma: Pick<PrismaClient, "telegramConnection">,
  where: Prisma.TelegramConnectionWhereInput,
  at: Date = new Date(),
): Promise<void> {
  try {
    await prisma.telegramConnection.updateMany({ data: { lastActiveAt: at }, where });
  } catch {
    // Stats only.
  }
}
