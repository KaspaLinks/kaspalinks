import { prisma } from "@kaspa-actions/db";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { absolutePublicUrl } from "@/lib/public-url";
import { parseQrOptions, qrImageResponse } from "@/lib/qr-response";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

type RouteContext = {
  params: Promise<{ username: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const parsed = parseQrOptions(request);
  if ("response" in parsed) return parsed.response;

  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(RateBuckets.QR_DOWNLOAD, ipHash);
  if (!limited.allowed) return limited.response;

  const { username } = await context.params;
  const normalized = username.trim().toLowerCase();
  if (!normalized) {
    return apiError(ErrorCodes.NOT_FOUND, "Profile not found.", 404);
  }

  const creator = await prisma.creator.findUnique({
    select: { username: true },
    where: { username: normalized },
  });

  if (!creator) {
    return apiError(ErrorCodes.NOT_FOUND, "Profile not found.", 404);
  }

  return qrImageResponse({
    filenameBase: `kaspalinks-profile-${creator.username}`,
    options: parsed.options,
    targetUrl: absolutePublicUrl(request, `/u/${encodeURIComponent(creator.username)}`),
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
