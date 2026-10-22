import { randomBytes } from "node:crypto";

import { AuditActorType, prisma } from "@kaspa-actions/db";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { generateCreatorToken, hashCreatorToken } from "@/lib/creator-auth";
import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import { giveawayV6AccessFor } from "@/lib/giveaway-v6-creation";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { verifyAccountFreeTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";

const bodySchema = z.object({ turnstileToken: z.string().max(2048).optional() }).strict();
const GUEST_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function guestUsername(): string {
  const bytes = randomBytes(10);
  let suffix = "";
  for (const byte of bytes) suffix += GUEST_ALPHABET[byte % GUEST_ALPHABET.length];
  return `guest-${suffix}`;
}

/**
 * A hidden workspace for running a giveaway on the website without a profile.
 * The browser keeps its token; the guard lets it use only the giveaway
 * endpoints, and its username never appears publicly.
 */
export async function POST(request: Request) {
  // A guest is never allowlisted, so it needs giveaways open to everyone.
  if (!giveawayV6AccessFor({ prizeCovenantEnabled: false })) {
    return apiError(ErrorCodes.NOT_FOUND, "Giveaways are not available.", 404);
  }
  const ip = extractClientIp(request.headers);
  const ipHash = hashClientIp(ip);
  const limited = enforceRateLimit(RateBuckets.GUEST_CREATOR_CREATE, ipHash);
  if (!limited.allowed) return limited.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Request body must be JSON.", 400);
  }
  const body = bodySchema.safeParse(raw);
  if (!body.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid request.", 400);

  const verified = await verifyAccountFreeTurnstile({
    remoteIp: ip,
    token: body.data.turnstileToken,
  });
  if (!verified.ok) {
    return apiError(
      verified.kind === "unavailable"
        ? ErrorCodes.BOT_VERIFICATION_UNAVAILABLE
        : ErrorCodes.BOT_VERIFICATION_FAILED,
      "Human verification failed. Please try again.",
      verified.kind === "unavailable" ? 503 : 403,
    );
  }

  const creatorToken = generateCreatorToken();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const creator = await prisma.creator.create({
        data: {
          accountKind: "GUEST",
          tokenHash: hashCreatorToken(creatorToken),
          username: guestUsername(),
        },
      });
      await writeAuditLog(prisma, {
        actorType: AuditActorType.CREATOR,
        creatorId: creator.id,
        event: "creator.guest_created",
        ipHash,
      });
      return apiJson({ creator: { username: creator.username }, creatorToken }, 201);
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error, ["username"])) throw error;
    }
  }
  return apiError(ErrorCodes.SERVER_ERROR, "Could not start a guest workspace. Retry.", 503);
}

const methodNotAllowed = () => apiMethodNotAllowed(["POST"]);

export {
  methodNotAllowed as DELETE,
  methodNotAllowed as GET,
  methodNotAllowed as PATCH,
  methodNotAllowed as PUT,
};
