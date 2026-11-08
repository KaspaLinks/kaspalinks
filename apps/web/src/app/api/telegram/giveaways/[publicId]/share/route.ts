import {
  preparedGiveawayArticle,
  preparedV6GiveawayArticle,
  TelegramApiClient,
  telegramGiveawayIdSchema,
} from "@kaspa-actions/agent";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { loadV6GiveawayShareInput } from "@/lib/giveaway-v6-share";
import { getTelegramGiveawayCard, requireTelegramParticipant } from "@/lib/telegram-giveaway";

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  const guard = requireTelegramParticipant(request);
  if (!guard.ok) return guard.response;
  const parsed = telegramGiveawayIdSchema.safeParse((await context.params).publicId);
  if (!parsed.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  const bot = process.env.TELEGRAM_BOT_USERNAME?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!bot || !appUrl)
    return apiError(ErrorCodes.SERVER_ERROR, "Telegram sharing is unavailable.", 503);
  try {
    // V6 giveaways get a card from their on-chain state; older ones keep theirs.
    const v6 = await loadV6GiveawayShareInput(parsed.data);
    const card = v6 ? null : await getTelegramGiveawayCard(parsed.data);
    if (!v6 && !card) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
    const client = new TelegramApiClient(process.env.TELEGRAM_BOT_TOKEN ?? "");
    const prepared = await client.savePreparedInlineMessage(
      guard.userId,
      v6 ? preparedV6GiveawayArticle(v6, appUrl) : preparedGiveawayArticle(card!, appUrl, bot),
    );
    return apiJson({ id: prepared.id, expiresAt: prepared.expiration_date });
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "The share card could not be prepared. Try again shortly.",
      503,
    );
  }
}
const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as GET,
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
