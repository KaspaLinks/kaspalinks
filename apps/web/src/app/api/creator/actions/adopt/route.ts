import { prisma } from "@kaspa-actions/db";
import { actorContext, adoptAccountFreeActionsTool } from "@kaspa-actions/application";
import { z } from "zod";

import { hashManageToken } from "@/lib/account-free-links";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";

// Moves payment links this browser created without an account into the signed-in
// account. Each link proves ownership with its private manage token.

const bodySchema = z.object({
  links: z
    .array(z.object({ manageToken: z.string().max(64), publicId: z.string().min(1).max(64) }))
    .min(1)
    .max(50),
});

export async function POST(request: Request) {
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, "Send up to 50 links with their manage tokens.", 400);
  }

  const links = parsed.data.links.flatMap((link) => {
    const manageTokenHash = hashManageToken(link.manageToken);
    return manageTokenHash ? [{ manageTokenHash, publicId: link.publicId }] : [];
  });
  const result = await adoptAccountFreeActionsTool(
    prisma,
    actorContext(guard.creator.id, "web"),
    links,
  );
  return apiJson(result);
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
