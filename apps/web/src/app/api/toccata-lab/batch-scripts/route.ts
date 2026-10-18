import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  createToccataClaimableLabScript,
  isToccataBatchLabEnabled,
  ToccataLabSdkUnavailableError,
  toccataBatchClaimableScriptInputSchema,
} from "@/lib/toccata-lab";

// Public like the single claim-script route: it only derives scripts from public
// keys and stores nothing. The batch flag keeps it off deployments that enable
// ordinary claimable links without Claim Drops.
export async function POST(request: Request) {
  if (!isToccataBatchLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Batch claim lab is disabled.", 403);
  }

  const limited = enforceRateLimit(
    RateBuckets.TOCCATA_LAB_BATCH_SCRIPT,
    hashClientIp(extractClientIp(request.headers)),
  );
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = toccataBatchClaimableScriptInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid batch claim-script request.",
      400,
    );
  }

  try {
    return apiJson({
      scripts: parsed.data.links.map((link) =>
        createToccataClaimableLabScript({ ...link, refundLockTime: parsed.data.refundLockTime }),
      ),
      warning: "Only public keys were received. Claim and refund codes remain in this browser.",
    });
  } catch (error) {
    if (error instanceof ToccataLabSdkUnavailableError) {
      return apiError(ErrorCodes.TOCCATA_SDK_UNAVAILABLE, error.message, 503);
    }
    return apiError(ErrorCodes.INVALID_BODY, (error as Error).message, 400);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
