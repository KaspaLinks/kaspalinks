import { Prisma, prisma } from "@kaspa-actions/db";

import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  enterGiveawayInputSchema,
  giveawayPublicIdSchema,
  hashGiveawayEntryAddress,
  isGiveawayLabEnabled,
  normalizeGiveawayAddress,
} from "@/lib/giveaway-lab";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { verifyGiveawayTurnstile } from "@/lib/turnstile";

export async function POST(request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const clientIp = extractClientIp(request.headers);
  const ipHash = hashClientIp(clientIp);
  const limited = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_ENTRY, ipHash);
  if (!limited.allowed) return limited.response;

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const parsed = enterGiveawayInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      parsed.error.issues[0]?.message ?? "Invalid giveaway entry.",
      400,
    );
  }

  const verification = await verifyGiveawayTurnstile({
    remoteIp: clientIp,
    token: parsed.data.turnstileToken,
  });
  if (!verification.ok) {
    return verification.kind === "unavailable"
      ? apiError(
          ErrorCodes.BOT_VERIFICATION_UNAVAILABLE,
          "Security verification is temporarily unavailable. Please try again.",
          503,
        )
      : apiError(
          ErrorCodes.BOT_VERIFICATION_FAILED,
          "Please complete the security check and try again.",
          403,
        );
  }

  let address: string;
  try {
    address = normalizeGiveawayAddress(parsed.data.address);
  } catch (error) {
    return apiError(
      ErrorCodes.INVALID_BODY,
      error instanceof Error ? error.message : "Invalid Kaspa address.",
      400,
    );
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const giveaway = await tx.giveaway.findUnique({ where: { publicId: parsedId.data } });
        if (!giveaway) return { kind: "missing" as const };
        if (giveaway.status !== "OPEN" || giveaway.closesAt.getTime() <= Date.now()) {
          return { kind: "closed" as const };
        }

        await tx.giveawayEntry.create({
          data: { address, giveawayId: giveaway.id, ipHash },
        });
        const entryCount = await tx.giveawayEntry.count({ where: { giveawayId: giveaway.id } });
        return { entryCount, kind: "created" as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.kind === "missing") {
      return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
    }
    if (result.kind === "closed") {
      return apiError(ErrorCodes.INVALID_STATE, "Giveaway entries are closed.", 409);
    }

    return apiJson(
      {
        entry: {
          address,
          entryHash: hashGiveawayEntryAddress(address),
        },
        entryCount: result.entryCount,
      },
      201,
    );
  } catch (error) {
    if (isPrismaUniqueConstraintError(error, ["giveawayId", "address"])) {
      return apiError(ErrorCodes.INVALID_STATE, "This address is already entered.", 409);
    }
    throw error;
  }
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);
export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
