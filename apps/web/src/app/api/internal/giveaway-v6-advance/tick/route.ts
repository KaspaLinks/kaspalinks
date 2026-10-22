import { createHash, timingSafeEqual } from "node:crypto";

import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { processUnattendedGiveawayV6Advances } from "@/lib/giveaway-v6-advance";
import { isGiveawayV6CreationEnabled } from "@/lib/giveaway-v6-creation";

// Called by the agent worker every few seconds: funded giveaways go live even
// when nobody keeps the studio open. Same internal secret as the other ticks.

function isAuthorized(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const presented = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  return Boolean(
    expected &&
    presented &&
    timingSafeEqual(
      createHash("sha256").update(expected).digest(),
      createHash("sha256").update(presented).digest(),
    ),
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return apiError(ErrorCodes.NOT_FOUND, "Not found.", 404);
  if (!isGiveawayV6CreationEnabled()) return apiJson({ skipped: true });
  try {
    return apiJson(await processUnattendedGiveawayV6Advances(new Date()));
  } catch (error) {
    console.error("[giveaway-v6-advance] tick failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return apiError(ErrorCodes.SERVER_ERROR, "Giveaway advance tick failed.", 503);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
