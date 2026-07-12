import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  createToccataLabPsktSmokePrototype,
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
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_PSKT_SMOKE, ipHash);
  if (!limited.allowed) return limited.response;

  try {
    return apiJson({
      prototype: createToccataLabPsktSmokePrototype(),
      warning:
        "Experimental PSKT/covenant smoke only. Do not fund the derived address. Kaspa Links does not sign, broadcast, or hold funds.",
    });
  } catch (error) {
    if (error instanceof ToccataLabSdkUnavailableError) {
      return apiError(ErrorCodes.TOCCATA_SDK_UNAVAILABLE, error.message, 503);
    }

    return apiError(ErrorCodes.SERVER_ERROR, "Could not run Toccata PSKT smoke test.", 500);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
