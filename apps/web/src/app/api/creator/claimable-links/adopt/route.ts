import { AuditActorType, prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { hashManageToken } from "@/lib/account-free-links";
import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";

// Moves claimable links this browser created without an account into the signed-in
// account. The private manage token proves ownership and is cleared afterwards.
// Nothing on-chain changes: the claim code and the return address stay the same.

const bodySchema = z.object({
  links: z
    .array(z.object({ linkKey: z.string().min(1).max(128), manageToken: z.string().max(64) }))
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

  const adopted: string[] = [];
  for (const link of parsed.data.links) {
    const manageTokenHash = hashManageToken(link.manageToken);
    if (!manageTokenHash) continue;
    const updated = await prisma.claimableLink.updateMany({
      data: { creatorId: guard.creator.id, manageTokenHash: null },
      where: { creatorId: null, deletedAt: null, linkKey: link.linkKey, manageTokenHash },
    });
    if (updated.count === 1) adopted.push(link.linkKey);
  }

  if (adopted.length > 0) {
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "claimable_link.adopted_account_free",
      ipHash: guard.ipHash,
      metadata: { count: adopted.length },
    });
  }
  return apiJson({ adopted });
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
