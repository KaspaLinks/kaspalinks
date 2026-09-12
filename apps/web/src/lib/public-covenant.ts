import { Prisma, prisma } from "@kaspa-actions/db";
import { readPrototypeChain, readPrototypeUtxos } from "./giveaway-prize-v3-chain";
import {
  prototypeEntries,
  prototypeManifestSchema,
  prototypeTerms,
} from "./giveaway-prize-v3-prototype";

export const PUBLIC_COVENANT_LIMIT = 100;
export function publicCovenantVerificationReady() {
  return (
    process.env.GIVEAWAY_TURNSTILE_ENABLED === "true" &&
    Boolean(process.env.TURNSTILE_SITE_KEY?.trim()) &&
    Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
  );
}
// Admission and snapshot take the same row lock. The chain deadline is checked
// inside it, so a request waiting for the lock cannot enter after closing.
export async function registerPublicCovenant(id: string, address: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "CovenantPrototype" WHERE id = ${id} FOR UPDATE`,
      );
      const row = await tx.covenantPrototype.findUnique({ where: { id } });
      if (!row?.publicTitle) throw new Error("Giveaway not found.");
      const manifest = prototypeManifestSchema.parse(row.manifest);
      const chain = await readPrototypeChain();
      if (row.entriesFrozenAt || chain.daa >= BigInt(manifest.closesAtDaa))
        throw new Error("Entries are closed.");
      const terms = prototypeTerms(manifest);
      const utxos = await readPrototypeUtxos(terms.open.address);
      if (
        !utxos.some(
          (u) =>
            u.amount === terms.fundingSompi &&
            BigInt(u.blockDaaScore) < BigInt(manifest.closesAtDaa),
        )
      )
        throw new Error("Prize funding is not available.");
      if (
        (await tx.covenantRegistration.count({ where: { prototypeId: id } })) >=
        PUBLIC_COVENANT_LIMIT
      )
        throw new Error("This giveaway is full.");
      const latest = await readPrototypeChain();
      if (latest.daa >= BigInt(manifest.closesAtDaa)) throw new Error("Entries are closed.");
      await tx.covenantRegistration.create({ data: { prototypeId: id, address } });
      await tx.auditLog.create({
        data: {
          creatorId: row.creatorId,
          event: "giveaway.covenant_entry_created",
          actorType: "PUBLIC",
          metadata: { prototypeId: id },
        },
      });
      return tx.covenantRegistration.count({ where: { prototypeId: id } });
    },
    { timeout: 25000, maxWait: 5000 },
  );
}
export async function freezePublicCovenant(id: string, creatorId: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "CovenantPrototype" WHERE id = ${id} FOR UPDATE`,
      );
      const row = await tx.covenantPrototype.findFirst({ where: { id, creatorId } });
      if (!row?.publicTitle || row.entriesFrozenAt) return row;
      const chain = await readPrototypeChain();
      const manifest = prototypeManifestSchema.parse(row.manifest);
      if (chain.daa <= BigInt(manifest.closesAtDaa))
        throw new Error("Entries have not closed yet.");
      const entries = await tx.covenantRegistration.findMany({
        where: { prototypeId: id },
        select: { address: true },
      });
      if (!entries.length && manifest.version !== 4)
        throw new Error("No participants. Recover the prize after the refund deadline.");
      const snapshot = prototypeManifestSchema.parse({
        ...manifest,
        entries: prototypeEntries(entries.map((e) => e.address)),
      });
      return tx.covenantPrototype.update({
        where: { id },
        data: { manifest: snapshot, entriesFrozenAt: new Date() },
      });
    },
    { timeout: 25000, maxWait: 5000 },
  );
}
