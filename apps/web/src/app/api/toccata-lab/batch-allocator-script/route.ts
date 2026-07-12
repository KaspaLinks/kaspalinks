import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  createToccataBatchAllocatorLabScript,
  isToccataBatchLabEnabled,
  ToccataLabSdkUnavailableError,
  toccataBatchAllocatorScriptInputSchema,
} from "@/lib/toccata-lab";

// Caddy Basic Auth and the separate feature flag keep this experimental
// constructor out of the public creator product. It receives public contract
// terms only, never any activation, claim, or recovery secret.
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

  const parsed = toccataBatchAllocatorScriptInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid batch allocator request.",
      400,
    );
  }

  try {
    return apiJson({
      allocator: createToccataBatchAllocatorLabScript(parsed.data),
      warning:
        "Only public keys and committed output scripts were received. All activation, claim, and recovery codes remain in this browser.",
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
