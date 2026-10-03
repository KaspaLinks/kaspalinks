import { prisma } from "@kaspa-actions/db";
import { executeCovenantAction } from "./giveaway-covenant-execution";
import {
  prototypeManifestSchema,
  prototypeRefundDaa,
  prototypeTerms,
} from "./giveaway-prize-v3-prototype";
import { z } from "zod";
import {
  readPrototypePayout,
  readPrototypeRefund,
  readPrototypeChain,
  readPrototypeUtxos,
} from "./giveaway-prize-v3-chain";
export async function processCovenantGiveaways(now = new Date()) {
  if (process.env.GIVEAWAY_COVENANT_PROTOTYPE_ENABLED !== "true") return;
  const due = await prisma.covenantPrototype.findMany({
    where: {
      publicTitle: { not: null },
      OR: [
        { manifest: { path: ["version"], equals: 4 } },
        { manifest: { path: ["version"], equals: 5 } },
      ],
      automationFinishedAt: null,
      automationNextAt: { lte: now },
    },
    orderBy: { automationNextAt: "asc" },
    take: 3,
  });
  for (const row of due) {
    const lease = await prisma.covenantPrototype.updateMany({
      where: { id: row.id, automationNextAt: row.automationNextAt, automationFinishedAt: null },
      data: { automationNextAt: new Date(now.getTime() + 120000) },
    });
    if (lease.count !== 1) continue;
    try {
      const m = prototypeManifestSchema.parse(row.manifest);
      const chain = await readPrototypeChain();
      if (chain.daa <= BigInt(m.closesAtDaa)) continue;
      if (m.version === 4 && chain.daa >= BigInt(m.refundDaa)) {
        await prisma.covenantPrototype.update({
          where: { id: row.id },
          data: { automationFinishedAt: new Date() },
        });
        continue;
      }
      const submitted = await prisma.auditLog.findFirst({
        where: {
          creatorId: row.creatorId,
          event: "giveaway.covenant_prototype_submitted",
          AND: [
            { metadata: { path: ["prototypeId"], equals: row.id } },
            { metadata: { path: ["mode"], equals: "draw" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { metadata: true },
      });
      const tx = z
        .object({ transactionId: z.string().regex(/^[0-9a-f]{64}$/) })
        .safeParse(submitted?.metadata);
      if (tx.success && (await readPrototypePayout(tx.data.transactionId, m)).confirmed) {
        await prisma.covenantPrototype.update({
          where: { id: row.id },
          data: { automationFinishedAt: new Date() },
        });
        continue;
      }
      const refundSubmission = await prisma.auditLog.findFirst({
        where: {
          creatorId: row.creatorId,
          event: "giveaway.covenant_prototype_submitted",
          AND: [
            { metadata: { path: ["prototypeId"], equals: row.id } },
            { metadata: { path: ["mode"], equals: "auto-refund" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { metadata: true, createdAt: true },
      });
      const refundTx = z
        .object({ transactionId: z.string().regex(/^[0-9a-f]{64}$/) })
        .safeParse(refundSubmission?.metadata);
      if (refundTx.success && (await readPrototypeRefund(refundTx.data.transactionId)).confirmed) {
        await prisma.covenantPrototype.update({
          where: { id: row.id },
          data: { automationFinishedAt: new Date() },
        });
        continue;
      }
      if (
        refundTx.success &&
        refundSubmission &&
        refundSubmission.createdAt.getTime() > now.getTime() - 120_000
      )
        continue;
      const terms = prototypeTerms(m);
      const frozen = await readPrototypeUtxos(terms.frozen.address);
      if (m.version === 5) {
        const frozenReady =
          chain.daa > BigInt(prototypeRefundDaa(m, "frozen")) &&
          frozen.some((u) => BigInt(u.amount) > BigInt(m.drawFeeSompi));
        const open = frozenReady ? [] : await readPrototypeUtxos(terms.open.address);
        const openReady =
          chain.daa > BigInt(prototypeRefundDaa(m, "open")) &&
          open.some((u) => BigInt(u.amount) > BigInt(m.drawFeeSompi));
        if (frozenReady || openReady) {
          const response = await executeCovenantAction(
            {
              action: "auto-refund",
              id: row.id,
              phase: frozenReady ? "frozen" : "open",
            },
            row.creatorId,
            "SYSTEM",
          );
          if (response.ok)
            await prisma.covenantPrototype.update({
              where: { id: row.id },
              data: { automationNextAt: new Date(Date.now() + 15_000) },
            });
          continue;
        }
      }
      if (
        row.entriesFrozenAt &&
        m.entries.length === 0 &&
        frozen.some((u) => u.amount === (BigInt(m.prizeSompi) + BigInt(m.drawFeeSompi)).toString())
      ) {
        await prisma.covenantPrototype.update({
          where: { id: row.id },
          data: { automationFinishedAt: new Date() },
        });
        continue;
      }
      const response = await executeCovenantAction(
        {
          action: frozen.some(
            (u) => u.amount === (BigInt(m.prizeSompi) + BigInt(m.drawFeeSompi)).toString(),
          )
            ? "draw"
            : "freeze",
          id: row.id,
        },
        row.creatorId,
        "SYSTEM",
      );
      if (response.ok)
        await prisma.covenantPrototype.update({
          where: { id: row.id },
          data: { automationNextAt: new Date(Date.now() + 15000) },
        });
    } catch {
      /* Keep the bounded lease; retry without exposing chain or signing errors. */
    }
  }
}
