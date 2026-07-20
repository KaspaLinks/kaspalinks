import { GiveawayStatus, prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { apiError, apiJson, apiMethodNotAllowed, ErrorCodes } from "@/lib/errors";
import {
  computeEmptyGiveawayDrawDigest,
  computeGiveawayDraw,
  effectiveGiveawayStatus,
  giveawayPublicIdSchema,
  isGiveawayLabEnabled,
  verifyGiveawaySeed,
} from "@/lib/giveaway-lab";

export async function GET(_request: Request, context: { params: Promise<{ publicId: string }> }) {
  if (!isGiveawayLabEnabled()) {
    return apiError(ErrorCodes.TOCCATA_LAB_DISABLED, "Giveaway lab is disabled.", 403);
  }

  const params = await context.params;
  const parsedId = giveawayPublicIdSchema.safeParse(params.publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const giveaway = await prisma.giveaway.findUnique({
    include: {
      _count: { select: { entries: true } },
      entries: { orderBy: { createdAt: "asc" }, select: { address: true, id: true } },
    },
    where: { publicId: parsedId.data },
  });
  if (!giveaway) return apiError(ErrorCodes.NOT_FOUND, "Giveaway not found.", 404);

  const drawn = giveaway.status === GiveawayStatus.DRAWN;
  let proof: ReturnType<typeof computeGiveawayDraw> | null = null;
  if (drawn) {
    try {
      proof = computeGiveawayDraw({
        closesAt: giveaway.closesAt,
        entries: giveaway.entries,
        publicId: giveaway.publicId,
        seedHex: giveaway.drawSeedHex,
      });
    } catch {
      return apiError(ErrorCodes.SERVER_ERROR, "Giveaway draw proof is invalid.", 500);
    }

    if (
      proof.digest !== giveaway.drawDigest ||
      proof.winnerAddress !== giveaway.winnerAddress ||
      proof.winnerEntryId !== giveaway.winnerEntryId ||
      proof.winnerIndex !== giveaway.winnerIndex ||
      !verifyGiveawaySeed(giveaway.drawSeedHex, giveaway.drawCommitment)
    ) {
      return apiError(ErrorCodes.SERVER_ERROR, "Giveaway draw proof is inconsistent.", 500);
    }
  }

  if (giveaway.status === GiveawayStatus.NO_ENTRIES) {
    const expectedDigest = computeEmptyGiveawayDrawDigest({
      closesAt: giveaway.closesAt,
      publicId: giveaway.publicId,
      seedHex: giveaway.drawSeedHex,
    });
    if (
      giveaway.drawDigest !== expectedDigest ||
      giveaway.entryCountAtDraw !== 0 ||
      !verifyGiveawaySeed(giveaway.drawSeedHex, giveaway.drawCommitment)
    ) {
      return apiError(ErrorCodes.SERVER_ERROR, "Giveaway draw proof is inconsistent.", 500);
    }
  }

  return apiJson({
    giveaway: {
      amountKas: formatSompiToKaspa(giveaway.amountSompi),
      closesAt: giveaway.closesAt.toISOString(),
      description: giveaway.description,
      drawCommitment: giveaway.drawCommitment,
      drawProof:
        drawn || giveaway.status === GiveawayStatus.NO_ENTRIES
          ? {
              digest: giveaway.drawDigest,
              entryCount: giveaway.entryCountAtDraw,
              entryHashes: proof?.entryHashes ?? [],
              seed: giveaway.drawSeedHex,
              winnerIndex: giveaway.winnerIndex,
            }
          : null,
      entryCount: giveaway._count.entries,
      publicId: giveaway.publicId,
      status: effectiveGiveawayStatus(giveaway.status, giveaway.closesAt),
      title: giveaway.title,
      winnerAddress: giveaway.winnerAddress,
    },
  });
}

const methodNotAllowed = () => apiMethodNotAllowed(["GET"]);
export {
  methodNotAllowed as DELETE,
  methodNotAllowed as PATCH,
  methodNotAllowed as POST,
  methodNotAllowed as PUT,
};
