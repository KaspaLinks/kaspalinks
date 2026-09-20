import { AuditActorType, prisma } from "@kaspa-actions/db";
import { buildKaspaAddressScriptPublicKeyHex } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { escrowLinkCreateSchema, ESCROW_LINK_DURATIONS_DAA } from "@/lib/escrow-link";
import { isEscrowPrototypeCreator, isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { ESCROW_CANARY_AMOUNT_SOMPI, ESCROW_CANARY_FEE_SOMPI } from "@/lib/escrow-canary";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";

async function guardCreator(request: Request, mutation: boolean) {
  if (!isEscrowPrototypeEnabled()) {
    return {
      ok: false as const,
      response: apiError(ErrorCodes.NOT_FOUND, "Escrow is disabled.", 404),
    };
  }
  const guard = await requireCreator(request, prisma, { allowTelegramMiniApp: true });
  if (!guard.ok) return guard;
  if (!isEscrowPrototypeCreator(guard.creator.username)) {
    return {
      ok: false as const,
      response: apiError(ErrorCodes.NOT_FOUND, "Escrow access is not enabled.", 404),
    };
  }
  const limited = enforceRateLimit(
    mutation ? RateBuckets.ESCROW_LINK_CREATOR_MUTATION : RateBuckets.ESCROW_PROTOTYPE_ACCESS,
    guard.creator.id,
  );
  return limited.allowed ? guard : { ok: false as const, response: limited.response };
}

function creatorEscrow(row: { createdAt: Date; publicId: string; status: string; title: string }) {
  return {
    createdAt: row.createdAt.toISOString(),
    publicId: row.publicId,
    sharePath: `/escrows/${row.publicId}`,
    status: row.status,
    title: row.title,
  };
}

export async function GET(request: Request) {
  const guard = await guardCreator(request, false);
  if (!guard.ok) return guard.response;
  try {
    const rows = await prisma.escrowLinkPrototype.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      where: { creatorId: guard.creator.id },
    });
    return apiJson({ escrows: rows.map(creatorEscrow) });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Escrow links are temporarily unavailable.", 503);
  }
}

export async function POST(request: Request) {
  const guard = await guardCreator(request, true);
  if (!guard.ok) return guard.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid JSON.", 400);
  }
  const parsed = escrowLinkCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid escrow link.", 400);

  try {
    buildKaspaAddressScriptPublicKeyHex(parsed.data.sellerAddress);
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Enter a valid Kaspa mainnet payout address.", 400);
  }
  const durationDaa = BigInt(parsed.data.durationDaa);
  if (!ESCROW_LINK_DURATIONS_DAA.some((duration) => duration === durationDaa)) {
    return apiError(ErrorCodes.INVALID_BODY, "Choose a supported escrow duration.", 400);
  }

  try {
    const row = await prisma.escrowLinkPrototype.create({
      data: {
        amountSompi: ESCROW_CANARY_AMOUNT_SOMPI,
        creatorId: guard.creator.id,
        durationDaa,
        feeSompi: ESCROW_CANARY_FEE_SOMPI,
        sellerAddress: parsed.data.sellerAddress,
        sellerPublicKey: parsed.data.sellerPublicKey,
        signerContextId: parsed.data.signerContextId,
        title: parsed.data.title,
      },
    });
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "escrow.link_created",
      ipHash: guard.ipHash,
      metadata: { durationDaa: durationDaa.toString(), publicId: row.publicId },
    });
    return apiJson({ escrow: creatorEscrow(row) }, 201);
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Escrow link could not be created.", 503);
  }
}
