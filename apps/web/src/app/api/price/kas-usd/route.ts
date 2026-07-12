import { getKasUsdPrice } from "@/lib/kas-price";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";

export async function GET() {
  try {
    const price = await getKasUsdPrice();
    return apiJson({ price });
  } catch {
    return apiError(ErrorCodes.PRICE_UNAVAILABLE, "KAS/USD price is temporarily unavailable.", 503);
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
