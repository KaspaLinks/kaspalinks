import { z } from "zod";
import { AuditActorType, Prisma, prisma } from "@kaspa-actions/db";
import { requireCreator } from "@/lib/creator-guard";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { writeAuditLog } from "@/lib/audit";
import {
  giveawayPrizeV3PlatformPublicKey,
  isGiveawayPrizeV3AttestationConfigured,
  signGiveawayV3EntriesAttestation,
  signGiveawayV3EntropyAttestation,
} from "@/lib/giveaway-prize-v3-attest";
import {
  buildPrototypeTransaction,
  createPrototypeManifest,
  prototypeCreateSchema,
  prototypeEntropySchema,
  prototypeManifestSchema,
  prototypeTerms,
  validatePrototypeRefundTransaction,
} from "@/lib/giveaway-prize-v3-prototype";
import {
  readPrototypePayout,
  readPrototypeChain,
  readPrototypeEntropy,
  readPrototypeUtxos,
  verifyPrototypeEntropy,
} from "@/lib/giveaway-prize-v3-chain";
import { broadcastToccataPreparedTransaction } from "@/lib/toccata-lab";

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
        prototypes: rows.map((r) => ({ id: r.id, manifest: r.manifest })),
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
    return apiJson({
      payout,
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
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), input: prototypeCreateSchema }).strict(),
  z.object({ action: z.enum(["freeze", "draw"]), id: z.string().cuid() }).strict(),
  z
    .object({
      action: z.enum(["prepare-refund", "broadcast-refund"]),
      id: z.string().cuid(),
      phase: z.enum(["open", "frozen"]),
      refundAddress: z.string().trim().min(20).max(150),
      transactionSafeJson: z.string().max(20_000).optional(),
    })
    .strict(),
]);
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
  const input = parsed.data;
  try {
    if (input.action === "create") {
      const chain = await readPrototypeChain();
      const manifest = createPrototypeManifest(input.input, {
        ...chain,
        platformPublicKeyHex: giveawayPrizeV3PlatformPublicKey(),
      });
      const terms = prototypeTerms(manifest);
      const row = await prisma.covenantPrototype.create({
        data: { creatorId: guard.creator.id, fundingAddress: terms.open.address, manifest },
      });
      await writeAuditLog(prisma, {
        actorType: AuditActorType.CREATOR,
        creatorId: guard.creator.id,
        event: "giveaway.covenant_prototype_created",
        metadata: { prototypeId: row.id },
      });
      return apiJson({ id: row.id, manifest, terms }, 201);
    }
    const row = await prisma.covenantPrototype.findFirst({
      where: { id: input.id, creatorId: guard.creator.id },
    });
    if (!row) return apiError(ErrorCodes.NOT_FOUND, "Prototype not found.", 404);
    const manifest = prototypeManifestSchema.parse(row.manifest);
    const terms = prototypeTerms(manifest);
    const chain = await readPrototypeChain();
    const refund = input.action === "prepare-refund" || input.action === "broadcast-refund";
    const phase = refund ? input.phase : input.action === "freeze" ? "open" : "frozen";
    const utxos = await readPrototypeUtxos(terms[phase].address);
    const expectedAmount =
      phase === "open"
        ? terms.fundingSompi
        : (BigInt(manifest.prizeSompi) + BigInt(manifest.drawFeeSompi)).toString();
    const utxo = utxos
      .filter((entry) =>
        refund
          ? BigInt(entry.amount) > BigInt(manifest.drawFeeSompi)
          : entry.amount === expectedAmount,
      )
      .sort((a, b) =>
        BigInt(a.blockDaaScore) === BigInt(b.blockDaaScore)
          ? a.transactionId.localeCompare(b.transactionId) || a.index - b.index
          : BigInt(a.blockDaaScore) < BigInt(b.blockDaaScore)
            ? -1
            : 1,
      )[0];
    if (!utxo)
      throw new Error("This step requires an unspent output with the expected funding amount.");
    if (input.action === "freeze" && BigInt(utxo.blockDaaScore) >= BigInt(manifest.closesAtDaa))
      throw new Error("Funding amount arrived after entry close. Use recovery after the deadline.");
    if (chain.daa <= BigInt(refund ? manifest.refundDaa : manifest.closesAtDaa))
      throw new Error("The covenant deadline has not been reached yet.");
    if (!refund && chain.daa >= BigInt(manifest.refundDaa))
      throw new Error("The draw window has ended. Use recovery.");
    let entropy = row.entropy ? prototypeEntropySchema.parse(row.entropy) : undefined;
    if (input.action === "draw") {
      if (!entropy) {
        const candidate = await readPrototypeEntropy(BigInt(manifest.entropyTargetBlueScore));
        // First attestation wins, including concurrent requests. Never silently reroll a reorg.
        await prisma.covenantPrototype.updateMany({
          where: { id: row.id, entropy: { equals: Prisma.DbNull } },
          data: { entropy: candidate },
        });
        const saved = await prisma.covenantPrototype.findUniqueOrThrow({ where: { id: row.id } });
        entropy = prototypeEntropySchema.parse(saved.entropy);
      }
      await verifyPrototypeEntropy(entropy);
    }
    const signatureHex = refund
      ? "00".repeat(65)
      : input.action === "freeze"
        ? signGiveawayV3EntriesAttestation({
            ...terms,
            expectedPlatformPublicKeyHex: manifest.platformPublicKeyHex,
          })
        : signGiveawayV3EntropyAttestation({
            paramsHashHex: terms.paramsHashHex,
            blockHashHex: entropy!.blockHash,
            expectedPlatformPublicKeyHex: manifest.platformPublicKeyHex,
          });
    const prepared = buildPrototypeTransaction({
      manifest,
      phase,
      utxo,
      mode: input.action === "freeze" ? "freeze" : input.action === "draw" ? "draw" : "refund",
      signatureHex,
      entropy,
      refundAddress: refund ? input.refundAddress : undefined,
    });
    if (input.action === "prepare-refund") return apiJson({ ...prepared, phase, manifest });
    const transactionSafeJson =
      input.action === "broadcast-refund"
        ? validatePrototypeRefundTransaction(
            input.transactionSafeJson ?? "",
            prepared.transactionSafeJson,
          )
        : prepared.transactionSafeJson;
    const result = await broadcastToccataPreparedTransaction({ transactionSafeJson });
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "giveaway.covenant_prototype_submitted",
      metadata: { prototypeId: row.id, mode: input.action, transactionId: result.transactionId },
    });
    return apiJson({
      ...result,
      feeSompi: prepared.feeSompi,
      winnerAddress: prepared.winnerAddress,
    });
  } catch (error) {
    // Never include raw SDK/DB errors, request bodies, or configuration in responses or logs.
    const known =
      error instanceof Error &&
      /^(This step|The covenant deadline|The draw window|The committed entropy|Entropy |The configured platform key|Funding amount|Each payout address|Only mainnet|Refund must|Signed refund|Reserved fee)/.test(
        error.message,
      );
    return apiError(
      ErrorCodes.INVALID_BODY,
      known
        ? error.message
        : "Prototype operation could not complete. Check its on-chain state before retrying.",
      409,
    );
  }
}
