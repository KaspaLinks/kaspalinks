import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { giveawayPublicIdSchema, isGiveawayLabEnabled } from "@/lib/giveaway-lab";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { finalizeGiveaway } from "@/lib/giveaway-draw";

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, ipHash);
  if (!limited.allowed) return limited.response;

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  return finalizeGiveaway(parsedId.data, ipHash);
}
const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as GET,
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
