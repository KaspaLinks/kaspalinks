import { isClaimableAutoReturnEnabled } from "@/lib/claimable-flags";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import {
  createToccataClaimableAutoReturnScript,
  createToccataClaimableLabScript,
  isToccataLabEnabled,
  ToccataLabSdkUnavailableError,
  toccataClaimableScriptRequestSchema,
} from "@/lib/toccata-lab";

export async function POST(request: Request) {
  if (!isToccataLabEnabled()) {
    return apiError(
      ErrorCodes.TOCCATA_LAB_DISABLED,
      "Claimable links are disabled on this deployment.",
      403,
    );
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_CLAIMABLE_SCRIPT, ipHash);
  if (!limited.allowed) return limited.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }

  const parsed = toccataClaimableScriptRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid claimable-link script request.",
      400,
    );
  }

  if ("version" in parsed.data && !isClaimableAutoReturnEnabled()) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      "Auto-return claimable links are not enabled on this deployment.",
      400,
    );
  }

  try {
    if ("version" in parsed.data) {
      const { feeSompi, linkPublicKey, refundLockTime, returnAddress } = parsed.data;
      return apiJson({
        script: createToccataClaimableAutoReturnScript({
          feeSompi,
          linkPublicKey,
          refundLockTime,
          returnAddress,
        }),
        warning: "The server received only the claim public key and the public return address.",
      });
    }
    return apiJson({
      script: createToccataClaimableLabScript(parsed.data),
      warning: "The server received only public keys and did not store claim/refund secrets.",
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
