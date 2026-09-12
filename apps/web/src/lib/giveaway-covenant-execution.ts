import { freezePublicCovenant, publicCovenantVerificationReady } from "@/lib/public-covenant";
import { z } from "zod";
import { AuditActorType, Prisma, prisma } from "@kaspa-actions/db";
import { apiError, apiJson, ErrorCodes } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";
import {
  giveawayPrizeV3PlatformPublicKey,
  signGiveawayV3EntriesAttestation,
  signGiveawayV3EntropyAttestation,
} from "@/lib/giveaway-prize-v3-attest";
import {
  buildPrototypeTransaction,
  createPrototypeManifest,
  prototypeRefundDaa,
  prototypeCreateSchema,
  prototypeEntropySchema,
  prototypeManifestSchema,
  prototypeTerms,
  validatePrototypeRefundTransaction,
} from "@/lib/giveaway-prize-v3-prototype";
import {
  readPrototypeChain,
  readPrototypeEntropy,
  readPrototypeUtxos,
  verifyPrototypeEntropy,
} from "@/lib/giveaway-prize-v3-chain";
import { broadcastToccataPreparedTransaction } from "@/lib/toccata-lab";

export const actionSchema = z.discriminatedUnion("action", [
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
export async function executeCovenantAction(
  input: z.infer<typeof actionSchema>,
  creatorId: string,
  actorType: "CREATOR" | "SYSTEM" = AuditActorType.CREATOR,
) {
  try {
    if (input.action === "create") {
      if (input.input.publicTitle && !publicCovenantVerificationReady())
        return apiError(
          ErrorCodes.SERVER_ERROR,
          "Public registration requires configured human verification.",
          503,
        );
      const chain = await readPrototypeChain();
      const manifest = createPrototypeManifest(input.input, {
        ...chain,
        platformPublicKeyHex: giveawayPrizeV3PlatformPublicKey(),
      });
      const terms = prototypeTerms(manifest);
      const row = await prisma.covenantPrototype.create({
        data: {
          creatorId: creatorId,
          fundingAddress: terms.open.address,
          manifest,
          publicTitle: input.input.publicTitle,
          automationNextAt: new Date(Date.now() + (input.input.durationMinutes ?? 5) * 60_000),
        },
      });
      await writeAuditLog(prisma, {
        actorType,
        creatorId: creatorId,
        event: "giveaway.covenant_prototype_created",
        metadata: { prototypeId: row.id },
      });
      return apiJson({ id: row.id, manifest, terms, publicTitle: row.publicTitle }, 201);
    }
    let row = await prisma.covenantPrototype.findFirst({
      where: { id: input.id, creatorId: creatorId },
    });
    if (row?.publicTitle && input.action === "freeze")
      row = await freezePublicCovenant(row.id, creatorId);
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
    if (chain.daa <= BigInt(refund ? prototypeRefundDaa(manifest, phase) : manifest.closesAtDaa))
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
      actorType,
      creatorId: creatorId,
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
