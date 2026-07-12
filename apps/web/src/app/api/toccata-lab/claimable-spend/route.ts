import { apiError, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isToccataLabEnabled } from "@/lib/toccata-lab";

export async function POST() {
  if (!isToccataLabEnabled()) {
    return apiError(
      ErrorCodes.TOCCATA_LAB_DISABLED,
      "Claimable links are disabled on this deployment.",
      403,
    );
  }

  return apiError(
    ErrorCodes.INVALID_STATE,
    "Server-side claimable spend signing is disabled. Use the browser signer and broadcast signed JSON only.",
    409,
  );
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
