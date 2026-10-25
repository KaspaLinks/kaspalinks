import { prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

// Status of claim links by key, so a browser can forget the claim codes of links
// that are finished. Public: the key is the public part of a claim link, and its
// page already shows whether it was claimed.

const bodySchema = z
  .object({
    linkKeys: z
      .array(
        z
          .string()
          .min(1)
          .max(128)
          .regex(/^[a-zA-Z0-9_-]+$/),
      )
      .min(1)
      .max(100),
  })
  .strict();

export async function POST(request: Request) {
  const limited = enforceRateLimit(
    RateBuckets.CLAIMABLE_STATUS,
    hashClientIp(extractClientIp(request.headers)),
  );
  if (!limited.allowed) return limited.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid link keys.", 400);

  const links = await prisma.claimableLink.findMany({
    select: { linkKey: true, status: true },
    where: { deletedAt: null, linkKey: { in: body.data.linkKeys } },
  });
  // Keys without a row are gone (for example never-paid links cleaned up later).
  return apiJson({
    statuses: Object.fromEntries(links.map((link) => [link.linkKey, link.status])),
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
