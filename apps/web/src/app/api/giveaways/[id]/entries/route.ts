import { z } from "zod";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { normalizeGiveawayAddress } from "@/lib/giveaway-lab";
import { publicCovenantVerificationReady, registerPublicCovenant } from "@/lib/public-covenant";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { verifyGiveawayTurnstile } from "@/lib/turnstile";
import { isPrismaUniqueConstraintError } from "@/lib/prisma-errors";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (process.env.GIVEAWAY_COVENANT_PROTOTYPE_ENABLED !== "true")
    return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  const ip = extractClientIp(request.headers);
  const limit = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_ENTRY, hashClientIp(ip));
  if (!limit.allowed) return limit.response;
  const id = z
    .string()
    .cuid()
    .safeParse((await context.params).id);
  if (!id.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);
  if (!publicCovenantVerificationReady())
    return apiError(
      ErrorCodes.BOT_VERIFICATION_UNAVAILABLE,
      "Human verification is unavailable. Please try later.",
      503,
    );
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid request.", 400);
  }
  const body = z
    .object({
      address: z.string().trim().min(20).max(150),
      turnstileToken: z.string().min(1).max(2048),
    })
    .strict()
    .safeParse(raw);
  if (!body.success)
    return apiError(
      ErrorCodes.INVALID_BODY,
      "Enter a valid address and complete the human check.",
      400,
    );
  let address: string;
  try {
    address = normalizeGiveawayAddress(body.data.address);
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Enter a valid Kaspa mainnet address.", 400);
  }
  const verified = await verifyGiveawayTurnstile({ token: body.data.turnstileToken, remoteIp: ip });
  if (!verified.ok)
    return apiError(
      verified.kind === "unavailable"
        ? ErrorCodes.BOT_VERIFICATION_UNAVAILABLE
        : ErrorCodes.BOT_VERIFICATION_FAILED,
      "Human verification failed. Please try again.",
      verified.kind === "unavailable" ? 503 : 403,
    );
  try {
    return apiJson({ entryCount: await registerPublicCovenant(id.data, address), address }, 201);
  } catch (e) {
    if (isPrismaUniqueConstraintError(e))
      return apiError(ErrorCodes.INVALID_STATE, "This address is already entered.", 409);
    const message = e instanceof Error ? e.message : "";
    if (
      [
        "Entries are closed.",
        "Prize funding is not available.",
        "This giveaway is full.",
        "Giveaway not found.",
      ].includes(message)
    )
      return apiError(ErrorCodes.INVALID_STATE, message, 409);
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Registration is temporarily unavailable. Please retry.",
      503,
    );
  }
}
