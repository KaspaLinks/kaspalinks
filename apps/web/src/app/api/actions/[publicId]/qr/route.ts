import { prisma } from "@kaspa-actions/db";

import { isActionDeleted, isActionDisabled, isActionExpired } from "@/lib/action-serializer";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { absolutePublicUrl } from "@/lib/public-url";
import { parseQrOptions, qrImageResponse } from "@/lib/qr-response";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

type RouteContext = {
  params: Promise<{ publicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const parsed = parseQrOptions(request);
  if ("response" in parsed) return parsed.response;

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.QR_DOWNLOAD, ipHash);
  if (!limited.allowed) return limited.response;

  const { publicId } = await context.params;
  const action = await prisma.action.findUnique({
    include: { creator: { select: { username: true } } },
    where: { publicId },
  });

  if (!action || isActionDeleted(action)) {
    return apiError(ErrorCodes.NOT_FOUND, "Action not found.", 404);
  }

  if (isActionDisabled(action)) {
    return apiError(ErrorCodes.ACTION_DISABLED, "Action is disabled.", 403);
  }

  if (isActionExpired(action)) {
    return apiError(ErrorCodes.ACTION_EXPIRED, "Action has expired.", 410);
  }

  const sharePath =
    action.slug && action.creator?.username
      ? `/u/${encodeURIComponent(action.creator.username)}/${encodeURIComponent(action.slug)}`
      : `/a/${encodeURIComponent(action.publicId)}`;

  return qrImageResponse({
    filenameBase: `kaspalinks-link-${action.slug ?? action.publicId}`,
    options: parsed.options,
    targetUrl: absolutePublicUrl(request, sharePath),
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
