import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  broadcastToccataBatchActivationTransaction,
  isToccataBatchLabEnabled,
  toccataBatchActivationBroadcastInputSchema,
} from "@/lib/toccata-lab";

// This route receives an already-signed SafeJSON transaction only. The batch
// activation key stays in the creator's browser and the covenant itself fixes
// every child output before anything reaches the relay.
export async function POST(request: Request) {
  if (!isToccataBatchLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Batch claim lab is disabled.", 403);
  }

  const limited = enforceRateLimit(
    RateBuckets.TOCCATA_LAB_CLAIMABLE_BROADCAST,
    hashClientIp(extractClientIp(request.headers)),
  );
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = toccataBatchActivationBroadcastInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid batch activation request.",
      400,
    );
  }

  try {
    const broadcast = await broadcastToccataBatchActivationTransaction(parsed.data);
    return apiJson({
      broadcast,
      warning:
        "The server relayed already-signed transaction JSON only. The browser kept the activation code and the covenant fixed all child outputs.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown batch activation error.";
    return apiError(
      message.toLowerCase().includes("timed out") ? ErrorCodes.UPSTREAM_TIMEOUT : ErrorCodes.INVALID_BODY,
      message,
      message.toLowerCase().includes("timed out") ? 504 : 400,
    );
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
