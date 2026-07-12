import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  createToccataLabSafeJsonSmokePrototype,
  isToccataLabEnabled,
  ToccataLabSdkUnavailableError,
} from "@/lib/toccata-lab";

export async function POST(request: Request) {
  if (!isToccataLabEnabled()) {
    return apiError(
      ErrorCodes.TOCCATA_LAB_DISABLED,
      "Toccata smoke probes are disabled on this deployment.",
      403,
    );
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_SAFE_JSON_SMOKE, ipHash);
  if (!limited.allowed) return limited.response;

  try {
    return apiJson({
      prototype: createToccataLabSafeJsonSmokePrototype(),
      warning:
        "Experimental SafeJSON transaction smoke only. This is decode-only, has no spendable inputs, and must not be funded or broadcast.",
    });
  } catch (error) {
    if (error instanceof ToccataLabSdkUnavailableError) {
      return apiError(ErrorCodes.TOCCATA_SDK_UNAVAILABLE, error.message, 503);
    }

    return apiError(ErrorCodes.SERVER_ERROR, "Could not run Toccata SafeJSON smoke test.", 500);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
