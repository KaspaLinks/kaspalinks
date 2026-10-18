import { prisma } from "@kaspa-actions/db";
import { ApplicationError, createAccountFreeActionTool } from "@kaspa-actions/application";

import { isAccountFreePaymentLinksEnabled } from "@/lib/account-free-links";
import { serializeAccountFreeAction } from "@/lib/action-serializer";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { createAccountFreeActionInputSchema, formatZodErrorMessage } from "@/lib/schemas";
import { verifyAccountFreeTurnstile } from "@/lib/turnstile";

// Payment links without a KaspaLinks account. The money always goes straight to
// the recipient address; the creator manages the link with a private manage link
// whose token never reaches us at creation (only its SHA-256 does).

export async function POST(request: Request) {
  if (!isAccountFreePaymentLinksEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Not found.", 404);
  }

  const ip = extractClientIp(request.headers);
  const ipHash = hashClientIp(ip);
  const limited = enforceRateLimit(RateBuckets.ACCOUNT_FREE_LINK_CREATE, ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = createAccountFreeActionInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, formatZodErrorMessage(parsed.error), 400);
  }
  const { manageTokenHash, source, turnstileToken, ...input } = parsed.data;

  const verified = await verifyAccountFreeTurnstile({ remoteIp: ip, token: turnstileToken });
  if (!verified.ok) {
    return apiError(
      verified.kind === "unavailable"
        ? ErrorCodes.BOT_VERIFICATION_UNAVAILABLE
        : ErrorCodes.BOT_VERIFICATION_FAILED,
      "Human verification failed. Please try again.",
      verified.kind === "unavailable" ? 503 : 403,
    );
  }

  const daily = enforceRateLimit(RateBuckets.ACCOUNT_FREE_LINK_DAILY, ipHash);
  if (!daily.allowed) return daily.response;

  try {
    const action = await createAccountFreeActionTool(prisma, input, {
      ipHash,
      manageTokenHash,
      source: source ?? null,
    });
    return apiJson({ action: serializeAccountFreeAction(action) }, 201);
  } catch (error) {
    if (isPrismaUniqueConstraintError(error, ["manageTokenHash"])) {
      return apiError(ErrorCodes.INVALID_STATE, "This manage link is already in use.", 409);
    }
    if (error instanceof ApplicationError) {
      return apiError(ErrorCodes.INVALID_BODY, error.message, error.status);
    }
    throw error;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
