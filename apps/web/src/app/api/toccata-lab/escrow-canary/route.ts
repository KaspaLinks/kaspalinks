import { AuditActorType, prisma, type EscrowPrototype } from "@kaspa-actions/db";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit";
import { requireCreator } from "@/lib/creator-guard";
import {
  createEscrowCanaryTerms,
  escrowCanaryActionSchema,
  ESCROW_CANARY_AMOUNT_SOMPI,
  ESCROW_CANARY_FEE_SOMPI,
  ESCROW_CANARY_FUNDING_SOMPI,
  escrowCanarySubmittedTransaction,
  prepareEscrowCanaryTransaction,
  selectEscrowCanaryUtxo,
  validateSignedEscrowCanaryTransaction,
  type EscrowCanaryMode,
} from "@/lib/escrow-canary";
import { isEscrowPrototypeCreator, isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { readPrototypeChain, readPrototypeUtxos } from "@/lib/giveaway-prize-v3-chain";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { broadcastToccataPreparedTransaction } from "@/lib/toccata-lab";

async function guardRequest(request: Request, mutation: boolean) {
  if (!isEscrowPrototypeEnabled()) {
    return {
      ok: false as const,
      response: apiError(ErrorCodes.NOT_FOUND, "Prototype is disabled.", 404),
    };
  }
  const guard = await requireCreator(request, prisma);
  if (!guard.ok) return guard;
  if (!isEscrowPrototypeCreator(guard.creator.username)) {
    return {
      ok: false as const,
      response: apiError(ErrorCodes.NOT_FOUND, "Prototype access is not enabled.", 404),
    };
  }
  const bucket = mutation
    ? RateBuckets.ESCROW_CANARY_MUTATION
    : RateBuckets.ESCROW_PROTOTYPE_ACCESS;
  const limit = enforceRateLimit(bucket, guard.creator.id);
  return limit.allowed ? guard : { ok: false as const, response: limit.response };
}

function assertCanaryConstants(row: EscrowPrototype) {
  if (row.amountSompi !== ESCROW_CANARY_AMOUNT_SOMPI || row.feeSompi !== ESCROW_CANARY_FEE_SOMPI) {
    throw new Error("Stored canary terms do not match this release.");
  }
}

async function canaryResponse(row: EscrowPrototype) {
  assertCanaryConstants(row);
  const [chain, utxos] = await Promise.all([
    readPrototypeChain(),
    readPrototypeUtxos(row.activeFundingAddress),
  ]);
  const funding = selectEscrowCanaryUtxo(utxos);
  return {
    id: row.id,
    signerContextId: row.signerContextId,
    buyerPublicKey: row.buyerPublicKey,
    sellerPublicKey: row.sellerPublicKey,
    payoutAddress: row.sellerAddress,
    activeFundingAddress: row.activeFundingAddress,
    frozenFundingAddress: row.frozenFundingAddress,
    amountSompi: row.amountSompi.toString(),
    feeSompi: row.feeSompi.toString(),
    fundingAmountSompi: ESCROW_CANARY_FUNDING_SOMPI.toString(),
    releaseAfter: row.releaseAfter.toString(),
    chainDaa: chain.daa.toString(),
    claimAvailable: chain.daa >= row.releaseAfter,
    status: row.status,
    submitted: escrowCanarySubmittedTransaction(row),
    funding: {
      state: funding.state,
      unexpectedOutputCount: utxos.filter(
        (utxo) => BigInt(utxo.amount) !== ESCROW_CANARY_FUNDING_SOMPI,
      ).length,
    },
  };
}

export async function GET(request: Request) {
  const guard = await guardRequest(request, false);
  if (!guard.ok) return guard.response;
  const query = z
    .object({ id: z.string().cuid().optional() })
    .strict()
    .safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid canary query.", 400);
  const id = query.data.id ?? "";
  try {
    const row = id
      ? await prisma.escrowPrototype.findFirst({ where: { id, creatorId: guard.creator.id } })
      : await prisma.escrowPrototype.findFirst({
          where: { creatorId: guard.creator.id },
          orderBy: { createdAt: "desc" },
        });
    if (!row) return apiJson({ canary: null });
    return apiJson({ canary: await canaryResponse(row) });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Mainnet escrow status is unavailable.", 503);
  }
}

async function readOwnedCanary(id: string, creatorId: string) {
  return prisma.escrowPrototype.findFirst({ where: { id, creatorId } });
}

async function readFundedSpend(row: EscrowPrototype, selectedMode: EscrowCanaryMode) {
  assertCanaryConstants(row);
  if (escrowCanarySubmittedTransaction(row) || row.status === "broadcasting") {
    throw new Error("This canary already has a submitted spend.");
  }
  const [chain, utxos] = await Promise.all([
    readPrototypeChain(),
    readPrototypeUtxos(row.activeFundingAddress),
  ]);
  if (selectedMode === "claim" && chain.daa < row.releaseAfter) {
    throw new Error("The claim deadline has not been reached.");
  }
  const funding = selectEscrowCanaryUtxo(utxos);
  if (funding.state !== "funded") {
    throw new Error(
      funding.state === "ambiguous"
        ? "More than one exact funding output was found. Stop and review the canary."
        : "The exact 0.22 KAS funding output is not available.",
    );
  }
  return funding.utxo;
}

export async function POST(request: Request) {
  const guard = await guardRequest(request, true);
  if (!guard.ok) return guard.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid JSON.", 400);
  }
  const parsed = escrowCanaryActionSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid escrow canary request.", 400);
  }

  try {
    if (parsed.data.action === "create") {
      const chain = await readPrototypeChain();
      let terms: ReturnType<typeof createEscrowCanaryTerms>;
      try {
        terms = createEscrowCanaryTerms({
          buyerPublicKey: parsed.data.buyerPublicKey,
          chainDaa: chain.daa,
          payoutAddress: parsed.data.payoutAddress,
          sellerPublicKey: parsed.data.sellerPublicKey,
        });
      } catch {
        return apiError(
          ErrorCodes.INVALID_BODY,
          "Payout address or passkey signer is invalid.",
          400,
        );
      }
      const row = await prisma.escrowPrototype.create({
        data: {
          creatorId: guard.creator.id,
          signerContextId: parsed.data.signerContextId,
          amountSompi: terms.parameters.amount,
          feeSompi: terms.parameters.fee,
          releaseAfter: terms.parameters.releaseAfter,
          buyerPublicKey: terms.parameters.buyerPublicKey,
          sellerPublicKey: terms.parameters.sellerPublicKey,
          buyerAddress: parsed.data.payoutAddress,
          sellerAddress: parsed.data.payoutAddress,
          activeFundingAddress: terms.active.address,
          frozenFundingAddress: terms.frozen.address,
        },
      });
      await writeAuditLog(prisma, {
        actorType: AuditActorType.CREATOR,
        creatorId: guard.creator.id,
        event: "escrow.canary_created",
        ipHash: guard.ipHash,
        metadata: { canaryId: row.id, fundingAddress: row.activeFundingAddress },
      });
      return apiJson({ canary: await canaryResponse(row) }, 201);
    }

    let row = await readOwnedCanary(parsed.data.id, guard.creator.id);
    if (!row) return apiError(ErrorCodes.NOT_FOUND, "Escrow canary not found.", 404);
    if (row.status === "broadcasting" && Date.now() - row.updatedAt.getTime() >= 120_000) {
      const reset = await prisma.escrowPrototype.updateMany({
        where: {
          id: row.id,
          creatorId: guard.creator.id,
          status: "broadcasting",
          updatedAt: { lt: new Date(Date.now() - 120_000) },
        },
        data: { status: "awaiting_funding" },
      });
      if (reset.count === 1) row = { ...row, status: "awaiting_funding" };
    }
    const utxo = await readFundedSpend(row, parsed.data.mode);

    if (parsed.data.action === "prepare") {
      return apiJson(prepareEscrowCanaryTransaction(row, parsed.data.mode, utxo));
    }

    const signed = validateSignedEscrowCanaryTransaction({
      mode: parsed.data.mode,
      row,
      transactionSafeJson: parsed.data.transactionSafeJson,
      utxo,
    });
    const locked = await prisma.escrowPrototype.updateMany({
      where: { id: row.id, creatorId: guard.creator.id, status: "awaiting_funding" },
      data: { status: "broadcasting" },
    });
    if (locked.count !== 1) {
      return apiError(ErrorCodes.INVALID_STATE, "Escrow broadcast is already in progress.", 409);
    }

    try {
      const submitted = await broadcastToccataPreparedTransaction({
        expectedTransactionId: signed.transactionId,
        transactionSafeJson: signed.transactionSafeJson,
      });
      const txField =
        parsed.data.mode === "release"
          ? { releaseTxId: submitted.transactionId }
          : parsed.data.mode === "refund"
            ? { refundTxId: submitted.transactionId }
            : { claimTxId: submitted.transactionId };
      await prisma.escrowPrototype.update({
        where: { id: row.id },
        data: { status: "submitted", ...txField },
      });
      await writeAuditLog(prisma, {
        actorType: AuditActorType.CREATOR,
        creatorId: guard.creator.id,
        event: "escrow.canary_submitted",
        ipHash: guard.ipHash,
        metadata: {
          canaryId: row.id,
          mode: parsed.data.mode,
          transactionId: submitted.transactionId,
        },
      });
      return apiJson({
        mode: parsed.data.mode,
        submittedTransactionId: submitted.submittedTransactionId,
        transactionId: submitted.transactionId,
      });
    } catch (error) {
      await prisma.escrowPrototype.updateMany({
        where: { id: row.id, status: "broadcasting" },
        data: { status: "awaiting_funding" },
      });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Escrow canary request failed.";
    const conflict = /already|deadline|funding|canonical|covenant|reviewed|commitment/iu.test(
      message,
    );
    return apiError(
      conflict ? ErrorCodes.INVALID_STATE : ErrorCodes.SERVER_ERROR,
      conflict ? message : "Escrow canary request failed. No transaction was submitted.",
      conflict ? 409 : 503,
    );
  }
}
