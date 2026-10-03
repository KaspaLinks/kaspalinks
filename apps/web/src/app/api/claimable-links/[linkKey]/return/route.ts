import { prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { returnExpiredClaimable } from "@/lib/claimable-return";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { isToccataLabEnabled } from "@/lib/toccata-lab";

// "Return now" for an expired v2 link. Deliberately public: the return is keyless
// and the script only allows the committed return address, so anyone may trigger
// it — the sender, the recipient, or this server's worker.

type RouteContext = { params: Promise<{ linkKey: string }> };

const linkKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

export async function POST(request: Request, context: RouteContext) {
  if (!isToccataLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Claimable links are disabled.", 403);
  }

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.CLAIMABLE_RETURN, ipHash);
  if (!limited.allowed) return limited.response;

  const parsedKey = linkKeySchema.safeParse((await context.params).linkKey);
  if (!parsedKey.success) {
    return apiError(ErrorCodes.INVALID_BODY, "Claimable link key is invalid.", 400);
  }

  const link = await prisma.claimableLink.findUnique({ where: { linkKey: parsedKey.data } });
  if (!link || link.scriptVersion !== 2) {
    return apiError(ErrorCodes.NOT_FOUND, "Auto-return claimable link was not found.", 404);
  }

  try {
    const outcome = await returnExpiredClaimable(link);
    switch (outcome.kind) {
      case "not_expired":
        return apiError(
          ErrorCodes.INVALID_STATE,
          "This link has not expired yet. Unclaimed KAS can be returned after expiry.",
          409,
        );
      case "nothing_to_return":
        return apiJson({ returned: false, transactionIds: [] });
      case "returned":
        return apiJson({ returned: true, transactionIds: outcome.transactionIds });
      default:
        return apiError(ErrorCodes.NOT_FOUND, "Auto-return claimable link was not found.", 404);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Return failed.";
    const timedOut =
      (error instanceof Error && error.name === "TimeoutError") ||
      message.toLowerCase().includes("timed out");
    console.error("[claimable-return] manual return failed", { linkKey: link.linkKey, message });
    return apiError(
      timedOut ? ErrorCodes.UPSTREAM_TIMEOUT : ErrorCodes.SERVER_ERROR,
      "The return could not be sent right now. Try again in a minute.",
      timedOut ? 504 : 502,
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
