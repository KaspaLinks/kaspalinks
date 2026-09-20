import { AuditActorType, prisma, type EscrowLinkPrototype } from "@kaspa-actions/db";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import {
  createEscrowV1Terms,
  escrowCanarySubmittedTransaction,
  prepareEscrowCanaryTransaction,
  selectEscrowCanaryUtxo,
  validateSignedEscrowCanaryTransaction,
  type EscrowCanaryMode,
} from "@/lib/escrow-canary";
import {
  assertEscrowLinkConstants,
  escrowLinkFundingSompi,
  escrowLinkPublicActionSchema,
  escrowLinkPublicIdSchema,
  joinedEscrowLinkRecord,
} from "@/lib/escrow-link";
import { isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { readPrototypeChain, readPrototypeUtxos } from "@/lib/giveaway-prize-v3-chain";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { broadcastToccataPreparedTransaction } from "@/lib/toccata-lab";

type RouteContext = { params: Promise<{ publicId: string }> };

function publicRateLimit(request: Request, publicId: string, mutation: boolean) {
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(
    mutation ? RateBuckets.ESCROW_LINK_PUBLIC_MUTATION : RateBuckets.ESCROW_LINK_PUBLIC_STATUS,
    `${ipHash}:${publicId}`,
  );
  return { ipHash, limited };
}

async function readPublicEscrow(publicId: string) {
  return prisma.escrowLinkPrototype.findUnique({
    include: { creator: { select: { username: true } } },
    where: { publicId },
  });
}

async function publicEscrowResponse(row: EscrowLinkPrototype & { creator: { username: string } }) {
  assertEscrowLinkConstants(row);
  const submitted = escrowCanarySubmittedTransaction(row);
  const base = {
    amountSompi: row.amountSompi.toString(),
    buyerAddress: row.buyerAddress,
    buyerPublicKey: row.buyerPublicKey,
    createdAt: row.createdAt.toISOString(),
    creatorUsername: row.creator.username,
    durationDaa: row.durationDaa.toString(),
    feeSompi: row.feeSompi.toString(),
    fundingAmountSompi: escrowLinkFundingSompi(row).toString(),
    publicId: row.publicId,
    sellerAddress: row.sellerAddress,
    sellerPublicKey: row.sellerPublicKey,
    signerContextId: row.signerContextId,
    status: row.status,
    submitted,
    title: row.title,
  };
  if (!row.activeFundingAddress || row.releaseAfter === null) {
    return {
      ...base,
      activeFundingAddress: null,
      chainDaa: null,
      claimAvailable: false,
      frozenFundingAddress: null,
      funding: { state: "not_ready" as const, unexpectedOutputCount: 0 },
      releaseAfter: null,
    };
  }
  const [chain, utxos] = await Promise.all([
    readPrototypeChain(),
    readPrototypeUtxos(row.activeFundingAddress),
  ]);
  const funding = selectEscrowCanaryUtxo(utxos);
  return {
    ...base,
    activeFundingAddress: row.activeFundingAddress,
    chainDaa: chain.daa.toString(),
    claimAvailable: chain.daa >= row.releaseAfter,
    frozenFundingAddress: row.frozenFundingAddress,
    funding: {
      state: funding.state,
      unexpectedOutputCount: utxos.filter(
        (utxo) => BigInt(utxo.amount) !== escrowLinkFundingSompi(row),
      ).length,
    },
    releaseAfter: row.releaseAfter.toString(),
  };
}

async function readFundedSpend(row: EscrowLinkPrototype, mode: EscrowCanaryMode) {
  const record = joinedEscrowLinkRecord(row);
  if (escrowCanarySubmittedTransaction(row) || row.status === "broadcasting") {
    throw new Error("This escrow already has a submitted spend.");
  }
  const [chain, utxos] = await Promise.all([
    readPrototypeChain(),
    readPrototypeUtxos(record.activeFundingAddress),
  ]);
  if (mode === "claim" && chain.daa < record.releaseAfter) {
    throw new Error("The claim deadline has not been reached.");
  }
  const funding = selectEscrowCanaryUtxo(utxos);
  if (funding.state !== "funded") {
    throw new Error(
      funding.state === "ambiguous"
        ? "More than one exact funding output was found. Stop and review this escrow."
        : "The exact 0.22 KAS funding output is not available.",
    );
  }
  return { record, utxo: funding.utxo };
}

export async function GET(request: Request, context: RouteContext) {
  if (!isEscrowPrototypeEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  }
  const parsedId = escrowLinkPublicIdSchema.safeParse((await context.params).publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  const { limited } = publicRateLimit(request, parsedId.data, false);
  if (!limited.allowed) return limited.response;
  try {
    const row = await readPublicEscrow(parsedId.data);
    if (!row) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
    return apiJson({ escrow: await publicEscrowResponse(row) });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Escrow status is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isEscrowPrototypeEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  }
  const parsedId = escrowLinkPublicIdSchema.safeParse((await context.params).publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  const { ipHash, limited } = publicRateLimit(request, parsedId.data, true);
  if (!limited.allowed) return limited.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid JSON.", 400);
  }
  const parsed = escrowLinkPublicActionSchema.safeParse(raw);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid escrow request.", 400);

  try {
    let row = await readPublicEscrow(parsedId.data);
    if (!row) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
    assertEscrowLinkConstants(row);

    if (parsed.data.action === "join") {
      if (row.status !== "awaiting_buyer" || row.buyerPublicKey) {
        return apiError(ErrorCodes.INVALID_STATE, "This escrow has already been accepted.", 409);
      }
      if (parsed.data.buyerPublicKey === row.sellerPublicKey) {
        return apiError(
          ErrorCodes.INVALID_BODY,
          "Buyer and seller must use separate signer roles.",
          400,
        );
      }
      const chain = await readPrototypeChain();
      let terms: ReturnType<typeof createEscrowV1Terms>;
      try {
        terms = createEscrowV1Terms({
          amount: row.amountSompi,
          buyerAddress: parsed.data.buyerAddress,
          buyerPublicKey: parsed.data.buyerPublicKey,
          fee: row.feeSompi,
          releaseAfter: chain.daa + row.durationDaa,
          sellerAddress: row.sellerAddress,
          sellerPublicKey: row.sellerPublicKey,
        });
      } catch {
        return apiError(
          ErrorCodes.INVALID_BODY,
          "Enter a valid Kaspa mainnet refund address.",
          400,
        );
      }
      const joined = await prisma.escrowLinkPrototype.updateMany({
        data: {
          activeFundingAddress: terms.active.address,
          buyerAddress: parsed.data.buyerAddress,
          buyerPublicKey: parsed.data.buyerPublicKey,
          frozenFundingAddress: terms.frozen.address,
          joinedAt: new Date(),
          releaseAfter: terms.parameters.releaseAfter,
          status: "awaiting_funding",
        },
        where: { buyerPublicKey: null, id: row.id, status: "awaiting_buyer" },
      });
      if (joined.count !== 1) {
        return apiError(ErrorCodes.INVALID_STATE, "This escrow has already been accepted.", 409);
      }
      await writeAuditLog(prisma, {
        actorType: AuditActorType.PUBLIC,
        creatorId: row.creatorId,
        event: "escrow.link_joined",
        ipHash,
        metadata: { publicId: row.publicId },
      });
      row = (await readPublicEscrow(parsedId.data))!;
      return apiJson({ escrow: await publicEscrowResponse(row) });
    }

    if (row.status === "broadcasting" && Date.now() - row.updatedAt.getTime() >= 120_000) {
      await prisma.escrowLinkPrototype.updateMany({
        data: { status: "awaiting_funding" },
        where: {
          id: row.id,
          status: "broadcasting",
          updatedAt: { lt: new Date(Date.now() - 120_000) },
        },
      });
      row = (await readPublicEscrow(parsedId.data))!;
    }
    const spend = await readFundedSpend(row, parsed.data.mode);
    if (parsed.data.action === "prepare") {
      return apiJson(prepareEscrowCanaryTransaction(spend.record, parsed.data.mode, spend.utxo));
    }

    const signed = validateSignedEscrowCanaryTransaction({
      mode: parsed.data.mode,
      row: spend.record,
      transactionSafeJson: parsed.data.transactionSafeJson,
      utxo: spend.utxo,
    });
    const locked = await prisma.escrowLinkPrototype.updateMany({
      data: { status: "broadcasting" },
      where: { id: row.id, status: "awaiting_funding" },
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
      await prisma.escrowLinkPrototype.update({
        data: { status: "submitted", ...txField },
        where: { id: row.id },
      });
      await writeAuditLog(prisma, {
        actorType: AuditActorType.PUBLIC,
        creatorId: row.creatorId,
        event: "escrow.link_submitted",
        ipHash,
        metadata: {
          mode: parsed.data.mode,
          publicId: row.publicId,
          transactionId: submitted.transactionId,
        },
      });
      return apiJson({
        mode: parsed.data.mode,
        submittedTransactionId: submitted.submittedTransactionId,
        transactionId: submitted.transactionId,
      });
    } catch (error) {
      await prisma.escrowLinkPrototype.updateMany({
        data: { status: "awaiting_funding" },
        where: { id: row.id, status: "broadcasting" },
      });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Escrow request failed.";
    const conflict =
      /accepted|already|buyer|deadline|funding|canonical|covenant|reviewed|commitment/iu.test(
        message,
      );
    return apiError(
      conflict ? ErrorCodes.INVALID_STATE : ErrorCodes.SERVER_ERROR,
      conflict ? message : "Escrow request failed. No transaction was submitted.",
      conflict ? 409 : 503,
    );
  }
}
