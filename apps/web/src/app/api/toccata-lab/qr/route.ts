import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { parseQrOptions, qrImageResponse } from "@/lib/qr-response";
import {
  createToccataLabQrUri,
  isToccataLabEnabled,
  ToccataLabSdkUnavailableError,
  toccataLabIntentInputSchema,
} from "@/lib/toccata-lab";

export async function GET(request: Request) {
  if (!isToccataLabEnabled()) {
    return apiError(
      ErrorCodes.TOCCATA_LAB_DISABLED,
      "Claimable links are disabled on this deployment.",
      403,
    );
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_QR, ipHash);
  if (!limited.allowed) return limited.response;

  const parsedOptions = parseQrOptions(request);
  if ("response" in parsedOptions) return parsedOptions.response;

  const url = new URL(request.url);
  const parsedInput = toccataLabIntentInputSchema.safeParse({
    amountKas: url.searchParams.get("amountKas") ?? "",
    label: url.searchParams.get("label"),
    message: url.searchParams.get("message"),
    recipientAddress: url.searchParams.get("recipientAddress") ?? "",
  });

  if (!parsedInput.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsedInput.error.issues[0]?.message ?? "Invalid claimable QR request.",
      400,
    );
  }

  let targetUrl: string;
  try {
    targetUrl = createToccataLabQrUri(parsedInput.data);
  } catch (error) {
    if (error instanceof ToccataLabSdkUnavailableError) {
      return apiError(ErrorCodes.TOCCATA_SDK_UNAVAILABLE, error.message, 503);
    }

    return apiError(ErrorCodes.INVALID_BODY, (error as Error).message, 400);
  }

  return qrImageResponse({
    filenameBase: "kaspa-links-claimable",
    options: parsedOptions.options,
    targetUrl,
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
