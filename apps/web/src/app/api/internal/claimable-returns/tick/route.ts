import { createHash, timingSafeEqual } from "node:crypto";

import { isClaimableAutoReturnEnabled } from "@/lib/claimable-flags";
import { processClaimableReturns } from "@/lib/claimable-return";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isToccataLabEnabled } from "@/lib/toccata-lab";

// Called by the agent worker about once a minute. Same internal secret as the
// giveaway tick; the work itself is keyless and harmless, the secret only keeps
// strangers from spending our indexer budget.

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
  // Existing v2 links must keep returning even if new v2 creation is switched off,
  // so only the lab switch gates this.
  if (!isToccataLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Claimable links are disabled.", 403);
  }

  try {
    const result = await processClaimableReturns(new Date());
    return apiJson({ ...result, autoReturnEnabled: isClaimableAutoReturnEnabled() });
  } catch (error) {
    console.error("[claimable-return] tick failed", {
      message: error instanceof Error ? error.message : "unknown error",
    });
    return apiError(ErrorCodes.SERVER_ERROR, "Claimable return tick failed.", 503);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
