import { prisma } from "@kaspa-actions/db";

import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { isEscrowPrototypeCreator, isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

// Tells the escrow prototype pages whether the signed-in creator may see them.
// Everyone else gets the same 404 as a disabled prototype, so the feature stays invisible.
export async function GET(request: Request) {
  if (!isEscrowPrototypeEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Not found.", 404);
  }

  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard.response;

  const limit = enforceRateLimit(RateBuckets.ESCROW_PROTOTYPE_ACCESS, guard.creator.id);
  if (!limit.allowed) return limit.response;

  if (!isEscrowPrototypeCreator(guard.creator.username)) {
    return apiError(ErrorCodes.NOT_FOUND, "Not found.", 404);
  }

  return apiJson({ enabled: true });
}

export function POST() {
  return apiMethodNotAllowed(["GET"]);
}
