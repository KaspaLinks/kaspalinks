import { AuditActorType, prisma } from "@kaspa-actions/db";
import {
  assertEscrowV2PublicKey,
  buildKaspaAddressScriptPublicKeyHex,
  ESCROW_V2_TEMPLATE_HASH,
} from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import { isEscrowPrototypeCreator, isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import {
  MEDIATED_ESCROW_AMOUNT_SOMPI,
  MEDIATED_ESCROW_FALLBACK_DAA,
  MEDIATED_ESCROW_FEE_SOMPI,
  mediatedEscrowCreateSchema,
} from "@/lib/mediated-escrow-v2";
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

function creatorEscrow(row: {
  createdAt: Date;
  mediatorLabel: string;
  publicId: string;
  status: string;
  title: string;
}) {
  return {
    createdAt: row.createdAt.toISOString(),
    mediatorLabel: row.mediatorLabel,
    publicId: row.publicId,
    sharePath: `/mediated-escrows/${row.publicId}`,
    status: row.status,
    title: row.title,
  };
}

export async function GET(request: Request) {
  const guard = await guardCreator(request, false);
  if (!guard.ok) return guard.response;
  try {
    const rows = await prisma.mediatedEscrowPrototype.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      where: { creatorId: guard.creator.id },
    });
    return apiJson({ escrows: rows.map(creatorEscrow) });
  } catch {
    return apiError(
      ErrorCodes.SERVER_ERROR,
      "Mediated escrow links are temporarily unavailable.",
      503,
    );
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
  const parsed = mediatedEscrowCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid escrow terms.", 400);
  try {
    buildKaspaAddressScriptPublicKeyHex(parsed.data.sellerAddress);
    assertEscrowV2PublicKey(parsed.data.sellerPublicKey);
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Enter a valid Kaspa mainnet payout address.", 400);
  }

  try {
    const row = await prisma.mediatedEscrowPrototype.create({
      data: {
        amountSompi: MEDIATED_ESCROW_AMOUNT_SOMPI,
        claimDelayDaa: BigInt(parsed.data.claimDelayDaa),
        contractTemplateHash: ESCROW_V2_TEMPLATE_HASH,
        creatorId: guard.creator.id,
        fallbackDelayDaa: MEDIATED_ESCROW_FALLBACK_DAA,
        feeSompi: MEDIATED_ESCROW_FEE_SOMPI,
        mediatorLabel: parsed.data.mediatorLabel,
        sellerAddress: parsed.data.sellerAddress,
        sellerPublicKey: parsed.data.sellerPublicKey,
        signerContextId: parsed.data.signerContextId,
        title: parsed.data.title,
      },
    });
    await writeAuditLog(prisma, {
      actorType: AuditActorType.CREATOR,
      creatorId: guard.creator.id,
      event: "escrow.v2_created",
      ipHash: guard.ipHash,
      metadata: {
        claimDelayDaa: row.claimDelayDaa.toString(),
        fallbackDelayDaa: row.fallbackDelayDaa.toString(),
        publicId: row.publicId,
      },
    });
    return apiJson({ escrow: creatorEscrow(row) }, 201);
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Mediated escrow link could not be created.", 503);
  }
}
