import { z } from "zod";
import { prisma } from "@kaspa-actions/db";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { isGiveawayPrizeV3AttestationConfigured } from "@/lib/giveaway-prize-v3-attest";
import { prototypeManifestSchema, prototypeTerms } from "@/lib/giveaway-prize-v3-prototype";
import {
  readPrototypeChain,
  readPrototypeUtxos,
  readPrototypeRefund,
  readPrototypePayout,
} from "@/lib/giveaway-prize-v3-chain";
import { actionSchema, executeCovenantAction } from "@/lib/giveaway-covenant-execution";
async function guardRequest(request: Request) {
  if (process.env.GIVEAWAY_COVENANT_PROTOTYPE_ENABLED !== "true")
    return {
      ok: false as const,
      response: apiError(ErrorCodes.NOT_FOUND, "Prototype is disabled.", 404),
    };
  const guard = await requireCreator(request, prisma, { allowTelegramMiniApp: true });
  if (!guard.ok) return guard;
  if (!guard.creator.prizeCovenantEnabled)
    return {
      ok: false as const,
      response: apiError(
        ErrorCodes.NOT_FOUND,
        "Prototype access is not enabled for this creator.",
        403,
      ),
    };
  const limit = enforceRateLimit(RateBuckets.TOCCATA_LAB_GIVEAWAY_MUTATION, guard.creator.id);
  return limit.allowed ? guard : { ok: false as const, response: limit.response };
}
export async function GET(request: Request) {
  const guard = await guardRequest(request);
  if (!guard.ok) return guard.response;
  const query = z
    .object({ id: z.string().cuid().optional() })
    .strict()
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid prototype ID.", 400);
  try {
    if (!query.data.id) {
      const rows = await prisma.covenantPrototype.findMany({
        where: { creatorId: guard.creator.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return apiJson({
        prototypes: rows.map((r) => ({
          id: r.id,
          manifest: r.manifest,
          publicTitle: r.publicTitle,
        })),
        signingAvailable: isGiveawayPrizeV3AttestationConfigured(),
      });
    }
    const row = await prisma.covenantPrototype.findFirst({
      where: { id: query.data.id, creatorId: guard.creator.id },
    });
    if (!row) return apiError(ErrorCodes.NOT_FOUND, "Prototype not found.", 404);
    const manifest = prototypeManifestSchema.parse(row.manifest);
    const terms = prototypeTerms(manifest);
    const [chain, open, frozen] = await Promise.all([
      readPrototypeChain(),
      readPrototypeUtxos(terms.open.address),
      readPrototypeUtxos(terms.frozen.address),
    ]);
    const submitted = await prisma.auditLog.findFirst({
      where: {
        creatorId: guard.creator.id,
        event: "giveaway.covenant_prototype_submitted",
        AND: [
          { metadata: { path: ["prototypeId"], equals: row.id } },
          { metadata: { path: ["mode"], equals: "draw" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const submission = z
      .object({ transactionId: z.string().regex(/^[0-9a-f]{64}$/) })
      .safeParse(submitted?.metadata);
    const payout = submission.success
      ? await readPrototypePayout(submission.data.transactionId, manifest)
      : null;
    const refundSubmission = await prisma.auditLog.findFirst({
      where: {
        creatorId: guard.creator.id,
        event: "giveaway.covenant_prototype_submitted",
        AND: [
          { metadata: { path: ["prototypeId"], equals: row.id } },
          { metadata: { path: ["mode"], equals: "broadcast-refund" } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const refundId = z
      .object({ transactionId: z.string().regex(/^[0-9a-f]{64}$/) })
      .safeParse(refundSubmission?.metadata);
    const refund = refundId.success ? await readPrototypeRefund(refundId.data.transactionId) : null;
    return apiJson({
      refund,
      payout,
      publicTitle: row.publicTitle,
      entryCount: row.publicTitle
        ? await prisma.covenantRegistration.count({ where: { prototypeId: row.id } })
        : manifest.entries.length,
      id: row.id,
      manifest,
      terms,
      chain: { daa: chain.daa.toString(), blueScore: chain.blueScore.toString() },
      open,
      frozen,
      entropy: row.entropy,
    });
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Prototype or mainnet data is unavailable. Try again before funding.",
      503,
    );
  }
}
export async function POST(request: Request) {
  const guard = await guardRequest(request);
  if (!guard.ok) return guard.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid JSON.", 400);
  }
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid prototype request.", 400);
  return executeCovenantAction(parsed.data, guard.creator.id);
}
