import { AuditActorType, prisma, type MediatedEscrowPrototype } from "@kaspa-actions/db";
import { assertEscrowV2PublicKey } from "@kaspa-actions/kaspa";

import { writeAuditLog } from "@/lib/audit";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { isEscrowPrototypeEnabled } from "@/lib/escrow-prototype-access";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { readPrototypeChain, readPrototypeUtxos } from "@/lib/giveaway-prize-v3-chain";
import {
  assertMediatedEscrowConstants,
  createMediatedEscrowTerms,
  MEDIATED_ESCROW_AMOUNT_SOMPI,
  MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI,
  MEDIATED_ESCROW_FUNDING_SOMPI,
  mediatedEscrowPublicActionSchema,
  mediatedEscrowPublicIdSchema,
  mediatedEscrowRequiredRoles,
  mediatedEscrowSignaturePushes,
  mediatedEscrowSubmittedTransaction,
  prepareMediatedEscrowTransaction,
  selectMediatedEscrowUtxo,
  validateMediatedEscrowSignatures,
  type MediatedEscrowMode,
} from "@/lib/mediated-escrow-v2";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { broadcastToccataPreparedTransaction } from "@/lib/toccata-lab";

type RouteContext = { params: Promise<{ publicId: string }> };
type Phase = "active" | "frozen";

const PROPOSAL_MAX_AGE_MS = 30 * 60 * 1000;

function publicRateLimit(request: Request, publicId: string, mutation: boolean) {
  const ipHash = hashClientIp(extractClientIp(request.headers));
  const limited = enforceRateLimit(
    mutation ? RateBuckets.ESCROW_LINK_PUBLIC_MUTATION : RateBuckets.ESCROW_LINK_PUBLIC_STATUS,
    `${ipHash}:${publicId}:v2`,
  );
  return { ipHash, limited };
}

async function readPublicEscrow(publicId: string) {
  return prisma.mediatedEscrowPrototype.findUnique({
    include: { creator: { select: { username: true } } },
    where: { publicId },
  });
}

type PublicRow = NonNullable<Awaited<ReturnType<typeof readPublicEscrow>>>;

function terminalTransaction(row: MediatedEscrowPrototype) {
  const terminal = [
    ["release", row.releaseTxId],
    ["refund", row.refundTxId],
    ["claim", row.claimTxId],
    ["agree", row.agreementTxId],
    ["arbitrate", row.arbitrationTxId],
    ["fallbackSeller", row.fallbackTxId],
  ] as const;
  const found = terminal.find(([, transactionId]) => transactionId);
  return found ? { mode: found[0], transactionId: found[1]! } : null;
}

function roleKeysReady(row: MediatedEscrowPrototype) {
  return Boolean(
    row.mediatorPublicKey &&
    row.buyerPublicKey &&
    row.buyerAddress &&
    row.activeFundingAddress &&
    row.frozenFundingAddress,
  );
}

async function clearStaleProposal(row: MediatedEscrowPrototype) {
  if (row.pendingCreatedAt && Date.now() - row.pendingCreatedAt.getTime() >= PROPOSAL_MAX_AGE_MS) {
    await prisma.mediatedEscrowPrototype.updateMany({
      data: {
        pendingBuyerShare: null,
        pendingCreatedAt: null,
        pendingMediatorParty: null,
        pendingMode: null,
        pendingTransactionJson: null,
      },
      where: { id: row.id, pendingCreatedAt: row.pendingCreatedAt },
    });
  }
}

async function publicEscrowResponse(row: PublicRow) {
  assertMediatedEscrowConstants(row);
  const base = {
    amountSompi: row.amountSompi.toString(),
    buyerAddress: row.buyerAddress,
    buyerPublicKey: row.buyerPublicKey,
    claimDelayDaa: row.claimDelayDaa.toString(),
    contractTemplateHash: row.contractTemplateHash,
    createdAt: row.createdAt.toISOString(),
    creatorUsername: row.creator.username,
    fallbackDelayDaa: row.fallbackDelayDaa.toString(),
    feeSompi: row.feeSompi.toString(),
    frozenPayoutSompi: MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI.toString(),
    fundingAmountSompi: MEDIATED_ESCROW_FUNDING_SOMPI.toString(),
    mediatorLabel: row.mediatorLabel,
    mediatorPublicKey: row.mediatorPublicKey,
    publicId: row.publicId,
    sellerAddress: row.sellerAddress,
    sellerPublicKey: row.sellerPublicKey,
    signerContextId: row.signerContextId,
    status: row.status,
    submitted: mediatedEscrowSubmittedTransaction(row),
    terminal: terminalTransaction(row),
    title: row.title,
  };
  if (!roleKeysReady(row)) {
    return {
      ...base,
      activeFundingAddress: null,
      chainDaa: null,
      claimAvailable: false,
      fallbackAvailable: false,
      frozenFundingAddress: null,
      funding: {
        active: "not_ready" as const,
        frozen: "not_ready" as const,
        unexpectedOutputCount: 0,
      },
      pendingProposal: null,
      phase: "onboarding" as const,
    };
  }
  const [chain, activeUtxos, frozenUtxos] = await Promise.all([
    readPrototypeChain(),
    readPrototypeUtxos(row.activeFundingAddress!),
    readPrototypeUtxos(row.frozenFundingAddress!),
  ]);
  const active = selectMediatedEscrowUtxo(activeUtxos, MEDIATED_ESCROW_FUNDING_SOMPI);
  const frozen = selectMediatedEscrowUtxo(frozenUtxos, MEDIATED_ESCROW_AMOUNT_SOMPI);
  const terminal = terminalTransaction(row);
  const phase = terminal
    ? ("complete" as const)
    : frozen.state === "funded"
      ? ("frozen" as const)
      : active.state === "funded"
        ? ("active" as const)
        : row.freezeTxId
          ? ("freeze_submitted" as const)
          : ("funding" as const);
  const activeAge =
    active.utxo && chain.daa >= BigInt(active.utxo.blockDaaScore)
      ? chain.daa - BigInt(active.utxo.blockDaaScore)
      : 0n;
  const frozenAge =
    frozen.utxo && chain.daa >= BigInt(frozen.utxo.blockDaaScore)
      ? chain.daa - BigInt(frozen.utxo.blockDaaScore)
      : 0n;
  let pendingProposal: null | {
    buyerShareSompi: string | null;
    createdAt: string;
    filledRoles: string[];
    mediatorParty: string | null;
    mode: string;
    transactionSafeJson: string;
  } = null;
  if (
    row.pendingTransactionJson &&
    row.pendingMode &&
    row.pendingCreatedAt &&
    Date.now() - row.pendingCreatedAt.getTime() < PROPOSAL_MAX_AGE_MS
  ) {
    try {
      const roles = mediatedEscrowRequiredRoles(
        row.pendingMode as MediatedEscrowMode,
        row.pendingMediatorParty === "buyer" || row.pendingMediatorParty === "seller"
          ? row.pendingMediatorParty
          : undefined,
      );
      const pushes = mediatedEscrowSignaturePushes(row.pendingTransactionJson, roles.length);
      pendingProposal = {
        buyerShareSompi: row.pendingBuyerShare?.toString() ?? null,
        createdAt: row.pendingCreatedAt.toISOString(),
        filledRoles: roles.filter((_, index) => pushes[index] !== `41${"00".repeat(64)}01`),
        mediatorParty: row.pendingMediatorParty,
        mode: row.pendingMode,
        transactionSafeJson: row.pendingTransactionJson,
      };
    } catch {
      pendingProposal = null;
    }
  }
  return {
    ...base,
    activeFundingAddress: row.activeFundingAddress,
    chainDaa: chain.daa.toString(),
    claimAvailable: active.state === "funded" && activeAge >= row.claimDelayDaa,
    fallbackAvailable: frozen.state === "funded" && frozenAge >= row.fallbackDelayDaa,
    frozenFundingAddress: row.frozenFundingAddress,
    funding: {
      active: active.state,
      frozen: frozen.state,
      unexpectedOutputCount:
        activeUtxos.filter((utxo) => BigInt(utxo.amount) !== MEDIATED_ESCROW_FUNDING_SOMPI).length +
        frozenUtxos.filter((utxo) => BigInt(utxo.amount) !== MEDIATED_ESCROW_AMOUNT_SOMPI).length,
    },
    pendingProposal,
    phase,
  };
}

function proposalTerms(input: {
  buyerShareSompi?: string;
  mediatorParty?: "buyer" | "seller";
  mode: MediatedEscrowMode;
}) {
  const joint = input.mode === "agree" || input.mode === "arbitrate";
  if (joint !== (input.buyerShareSompi !== undefined)) {
    throw new Error("A split is required only for a joint escrow resolution.");
  }
  const buyerShareSompi =
    input.buyerShareSompi === undefined ? undefined : BigInt(input.buyerShareSompi);
  if (
    buyerShareSompi !== undefined &&
    (buyerShareSompi < 0n || buyerShareSompi > MEDIATED_ESCROW_FROZEN_PAYOUT_SOMPI)
  ) {
    throw new Error("The buyer share is outside the available frozen amount.");
  }
  if ((input.mode === "arbitrate") !== (input.mediatorParty !== undefined)) {
    throw new Error("Only a mediator resolution chooses the co-signing party.");
  }
  return { buyerShareSompi, mediatorParty: input.mediatorParty };
}

async function readSpend(row: MediatedEscrowPrototype, mode: MediatedEscrowMode) {
  if (!roleKeysReady(row)) throw new Error("All three roles must join before funding.");
  if (terminalTransaction(row)) throw new Error("This escrow already has a terminal transaction.");
  if (row.status === "broadcasting") throw new Error("An escrow broadcast is already in progress.");
  const [chain, activeUtxos, frozenUtxos] = await Promise.all([
    readPrototypeChain(),
    readPrototypeUtxos(row.activeFundingAddress!),
    readPrototypeUtxos(row.frozenFundingAddress!),
  ]);
  const active = selectMediatedEscrowUtxo(activeUtxos, MEDIATED_ESCROW_FUNDING_SOMPI);
  const frozen = selectMediatedEscrowUtxo(frozenUtxos, MEDIATED_ESCROW_AMOUNT_SOMPI);
  const phase: Phase =
    mode === "refund" && frozen.state === "funded"
      ? "frozen"
      : mode === "agree" || mode === "arbitrate" || mode === "fallbackSeller"
        ? "frozen"
      : "active";
  if (row.freezeTxId && phase === "active") {
    throw new Error("The freeze transaction was already submitted; wait for its confirmation.");
  }
  const selected = phase === "active" ? active : frozen;
  if (selected.state !== "funded") {
    throw new Error(
      selected.state === "ambiguous"
        ? `More than one exact ${phase} escrow output was found.`
        : `The exact ${phase} escrow output is not available.`,
    );
  }
  const age =
    chain.daa >= BigInt(selected.utxo.blockDaaScore)
      ? chain.daa - BigInt(selected.utxo.blockDaaScore)
      : 0n;
  if (mode === "claim" && age < row.claimDelayDaa) {
    throw new Error("The seller claim delay has not elapsed.");
  }
  if (mode === "fallbackSeller" && age < row.fallbackDelayDaa) {
    throw new Error("The 30-day frozen fallback delay has not elapsed.");
  }
  return { phase, utxo: selected.utxo };
}

function sameProposal(
  row: MediatedEscrowPrototype,
  input: { buyerShareSompi?: bigint; mediatorParty?: string; mode: string },
) {
  return (
    row.pendingMode === input.mode &&
    row.pendingBuyerShare === (input.buyerShareSompi ?? null) &&
    row.pendingMediatorParty === (input.mediatorParty ?? null)
  );
}

function txField(mode: MediatedEscrowMode, transactionId: string) {
  if (mode === "release") return { releaseTxId: transactionId };
  if (mode === "refund") return { refundTxId: transactionId };
  if (mode === "claim") return { claimTxId: transactionId };
  if (mode === "freeze") return { freezeTxId: transactionId };
  if (mode === "agree") return { agreementTxId: transactionId };
  if (mode === "arbitrate") return { arbitrationTxId: transactionId };
  return { fallbackTxId: transactionId };
}

export async function GET(request: Request, context: RouteContext) {
  if (!isEscrowPrototypeEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  }
  const parsedId = mediatedEscrowPublicIdSchema.safeParse((await context.params).publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  const { limited } = publicRateLimit(request, parsedId.data, false);
  if (!limited.allowed) return limited.response;
  try {
    let row = await readPublicEscrow(parsedId.data);
    if (!row) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
    await clearStaleProposal(row);
    if (
      row.pendingCreatedAt &&
      Date.now() - row.pendingCreatedAt.getTime() >= PROPOSAL_MAX_AGE_MS
    ) {
      row = (await readPublicEscrow(parsedId.data))!;
    }
    if (row.status === "broadcasting" && Date.now() - row.updatedAt.getTime() >= 120_000) {
      await prisma.mediatedEscrowPrototype.updateMany({
        data: { status: row.freezeTxId ? "freeze_submitted" : "awaiting_funding" },
        where: {
          id: row.id,
          status: "broadcasting",
          updatedAt: { lt: new Date(Date.now() - 120_000) },
        },
      });
      row = (await readPublicEscrow(parsedId.data))!;
    }
    return apiJson({ escrow: await publicEscrowResponse(row) });
  } catch {
    return apiError(ErrorCodes.SERVER_ERROR, "Escrow status is temporarily unavailable.", 503);
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isEscrowPrototypeEnabled()) {
    return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  }
  const parsedId = mediatedEscrowPublicIdSchema.safeParse((await context.params).publicId);
  if (!parsedId.success) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
  const { ipHash, limited } = publicRateLimit(request, parsedId.data, true);
  if (!limited.allowed) return limited.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError(ErrorCodes.INVALID_BODY, "Invalid JSON.", 400);
  }
  const parsed = mediatedEscrowPublicActionSchema.safeParse(raw);
  if (!parsed.success) return apiError(ErrorCodes.INVALID_BODY, "Invalid escrow request.", 400);

  try {
    let row = await readPublicEscrow(parsedId.data);
    if (!row) return apiError(ErrorCodes.NOT_FOUND, "Escrow not found.", 404);
    await clearStaleProposal(row);
    if (
      row.pendingCreatedAt &&
      Date.now() - row.pendingCreatedAt.getTime() >= PROPOSAL_MAX_AGE_MS
    ) {
      row = (await readPublicEscrow(parsedId.data))!;
    }
    if (row.status === "broadcasting" && Date.now() - row.updatedAt.getTime() >= 120_000) {
      await prisma.mediatedEscrowPrototype.updateMany({
        data: { status: row.freezeTxId ? "freeze_submitted" : "awaiting_funding" },
        where: {
          id: row.id,
          status: "broadcasting",
          updatedAt: { lt: new Date(Date.now() - 120_000) },
        },
      });
      row = (await readPublicEscrow(parsedId.data))!;
    }

    if (parsed.data.action === "joinMediator") {
      if (row.status !== "awaiting_mediator" || row.mediatorPublicKey) {
        return apiError(ErrorCodes.INVALID_STATE, "The mediator role is already assigned.", 409);
      }
      if (parsed.data.mediatorPublicKey === row.sellerPublicKey) {
        return apiError(ErrorCodes.INVALID_BODY, "Mediator and seller keys must differ.", 400);
      }
      try {
        assertEscrowV2PublicKey(parsed.data.mediatorPublicKey);
      } catch {
        return apiError(ErrorCodes.INVALID_BODY, "Invalid mediator public key.", 400);
      }
      const joined = await prisma.mediatedEscrowPrototype.updateMany({
        data: {
          mediatorJoinedAt: new Date(),
          mediatorPublicKey: parsed.data.mediatorPublicKey,
          status: "awaiting_buyer",
        },
        where: { id: row.id, mediatorPublicKey: null, status: "awaiting_mediator" },
      });
      if (joined.count !== 1) {
        return apiError(ErrorCodes.INVALID_STATE, "The mediator role is already assigned.", 409);
      }
      await writeAuditLog(prisma, {
        actorType: AuditActorType.PUBLIC,
        creatorId: row.creatorId,
        event: "escrow.v2_mediator_joined",
        ipHash,
        metadata: { publicId: row.publicId },
      });
      row = (await readPublicEscrow(parsedId.data))!;
      return apiJson({ escrow: await publicEscrowResponse(row) });
    }

    if (parsed.data.action === "joinBuyer") {
      if (row.status !== "awaiting_buyer" || row.buyerPublicKey || !row.mediatorPublicKey) {
        return apiError(ErrorCodes.INVALID_STATE, "This escrow is not ready for a buyer.", 409);
      }
      if (
        parsed.data.buyerPublicKey === row.sellerPublicKey ||
        parsed.data.buyerPublicKey === row.mediatorPublicKey
      ) {
        return apiError(
          ErrorCodes.INVALID_BODY,
          "All three signer roles must use different keys.",
          400,
        );
      }
      let terms: ReturnType<typeof createMediatedEscrowTerms>;
      try {
        terms = createMediatedEscrowTerms({
          buyerAddress: parsed.data.buyerAddress,
          buyerPublicKey: parsed.data.buyerPublicKey,
          claimDelayDaa: row.claimDelayDaa,
          mediatorPublicKey: row.mediatorPublicKey,
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
      const joined = await prisma.mediatedEscrowPrototype.updateMany({
        data: {
          activeFundingAddress: terms.active.address,
          buyerAddress: parsed.data.buyerAddress,
          buyerJoinedAt: new Date(),
          buyerPublicKey: parsed.data.buyerPublicKey,
          frozenFundingAddress: terms.frozen.address,
          status: "awaiting_funding",
        },
        where: { buyerPublicKey: null, id: row.id, status: "awaiting_buyer" },
      });
      if (joined.count !== 1) {
        return apiError(ErrorCodes.INVALID_STATE, "The buyer role is already assigned.", 409);
      }
      await writeAuditLog(prisma, {
        actorType: AuditActorType.PUBLIC,
        creatorId: row.creatorId,
        event: "escrow.v2_buyer_joined",
        ipHash,
        metadata: { publicId: row.publicId },
      });
      row = (await readPublicEscrow(parsedId.data))!;
      return apiJson({ escrow: await publicEscrowResponse(row) });
    }

    if (parsed.data.action === "clearProposal") {
      return apiError(
        ErrorCodes.INVALID_STATE,
        "Proposals expire automatically after 30 minutes.",
        409,
      );
    }

    const terms = proposalTerms(parsed.data);
    const spend = await readSpend(row, parsed.data.mode);
    const prepared = prepareMediatedEscrowTransaction({
      ...terms,
      mode: parsed.data.mode,
      phase: spend.phase,
      row,
      utxo: spend.utxo,
    });

    if (parsed.data.action === "prepare") {
      if (row.pendingTransactionJson && sameProposal(row, { ...terms, mode: parsed.data.mode })) {
        validateMediatedEscrowSignatures({
          ...terms,
          complete: false,
          mode: parsed.data.mode,
          phase: spend.phase,
          row,
          transactionSafeJson: row.pendingTransactionJson,
          utxo: spend.utxo,
        });
        return apiJson({ ...prepared, transactionSafeJson: row.pendingTransactionJson });
      }
      return apiJson(prepared);
    }

    const roles = mediatedEscrowRequiredRoles(parsed.data.mode, terms.mediatorParty);
    const roleSlot = roles.indexOf(parsed.data.role);
    if (roleSlot < 0) {
      return apiError(ErrorCodes.INVALID_BODY, "This role cannot sign the selected action.", 400);
    }
    const signed = validateMediatedEscrowSignatures({
      ...terms,
      complete: false,
      mode: parsed.data.mode,
      phase: spend.phase,
      row,
      transactionSafeJson: parsed.data.transactionSafeJson,
      utxo: spend.utxo,
    });
    if (!signed.filled[roleSlot]) {
      return apiError(
        ErrorCodes.INVALID_BODY,
        "The selected role did not fill its signature.",
        400,
      );
    }
    if (row.pendingTransactionJson) {
      if (!sameProposal(row, { ...terms, mode: parsed.data.mode })) {
        return apiError(
          ErrorCodes.INVALID_STATE,
          "A different resolution proposal is pending.",
          409,
        );
      }
      const oldPushes = mediatedEscrowSignaturePushes(row.pendingTransactionJson, roles.length);
      const newPushes = mediatedEscrowSignaturePushes(signed.transactionSafeJson, roles.length);
      for (const [index, push] of oldPushes.entries()) {
        if (push !== `41${"00".repeat(64)}01` && newPushes[index] !== push) {
          return apiError(ErrorCodes.INVALID_BODY, "A previous signer signature was changed.", 400);
        }
      }
    }

    if (!signed.filled.every(Boolean)) {
      const saved = await prisma.mediatedEscrowPrototype.updateMany({
        data: {
          pendingBuyerShare: terms.buyerShareSompi ?? null,
          pendingCreatedAt: new Date(),
          pendingMediatorParty: terms.mediatorParty ?? null,
          pendingMode: parsed.data.mode,
          pendingTransactionJson: signed.transactionSafeJson,
        },
        where: {
          id: row.id,
          ...(row.pendingTransactionJson
            ? { pendingTransactionJson: row.pendingTransactionJson }
            : { pendingTransactionJson: null }),
        },
      });
      if (saved.count !== 1) {
        return apiError(
          ErrorCodes.INVALID_STATE,
          "Another resolution proposal was saved first.",
          409,
        );
      }
      await writeAuditLog(prisma, {
        actorType: AuditActorType.PUBLIC,
        creatorId: row.creatorId,
        event: "escrow.v2_signature_saved",
        ipHash,
        metadata: { mode: parsed.data.mode, publicId: row.publicId, role: parsed.data.role },
      });
      return apiJson({ complete: false, pending: true });
    }

    const complete = validateMediatedEscrowSignatures({
      ...terms,
      complete: true,
      mode: parsed.data.mode,
      phase: spend.phase,
      row,
      transactionSafeJson: signed.transactionSafeJson,
      utxo: spend.utxo,
    });
    const previousStatus = row.status;
    const locked = await prisma.mediatedEscrowPrototype.updateMany({
      data: { status: "broadcasting" },
      where: { id: row.id, status: previousStatus },
    });
    if (locked.count !== 1) {
      return apiError(ErrorCodes.INVALID_STATE, "Escrow broadcast is already in progress.", 409);
    }
    try {
      const submitted = await broadcastToccataPreparedTransaction({
        expectedTransactionId: complete.transactionId,
        transactionSafeJson: complete.transactionSafeJson,
      });
      await prisma.mediatedEscrowPrototype.update({
        data: {
          ...txField(parsed.data.mode, submitted.transactionId),
          pendingBuyerShare: null,
          pendingCreatedAt: null,
          pendingMediatorParty: null,
          pendingMode: null,
          pendingTransactionJson: null,
          status: parsed.data.mode === "freeze" ? "freeze_submitted" : "submitted",
        },
        where: { id: row.id },
      });
      await writeAuditLog(prisma, {
        actorType: AuditActorType.PUBLIC,
        creatorId: row.creatorId,
        event: "escrow.v2_submitted",
        ipHash,
        metadata: {
          mode: parsed.data.mode,
          publicId: row.publicId,
          transactionId: submitted.transactionId,
        },
      });
      return apiJson({
        complete: true,
        mode: parsed.data.mode,
        submittedTransactionId: submitted.submittedTransactionId,
        transactionId: submitted.transactionId,
      });
    } catch (error) {
      await prisma.mediatedEscrowPrototype.updateMany({
        data: { status: previousStatus },
        where: { id: row.id, status: "broadcasting" },
      });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Escrow request failed.";
    const conflict =
      /already|available|broadcast|buyer|deadline|delay|escrow|funding|mediator|phase|proposal|role|signature|split/iu.test(
        message,
      );
    return apiError(
      conflict ? ErrorCodes.INVALID_STATE : ErrorCodes.SERVER_ERROR,
      conflict ? message : "Escrow request failed. No transaction was submitted.",
      conflict ? 409 : 503,
    );
  }
}
