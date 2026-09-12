import { headers } from "next/headers";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import {
  readPrototypeChain,
  readPrototypeUtxos,
  readPrototypePayout,
} from "@/lib/giveaway-prize-v3-chain";
import { prototypeManifestSchema, prototypeTerms } from "@/lib/giveaway-prize-v3-prototype";
import { publicCovenantVerificationReady, PUBLIC_COVENANT_LIMIT } from "@/lib/public-covenant";
import EntryClient from "./EntryClient";
export const dynamic = "force-dynamic";
export default async function GiveawayPage({ params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit(
    RateBuckets.TOCCATA_LAB_FUNDING_STATUS,
    hashClientIp(extractClientIp(await headers())),
  );
  if (!limited.allowed)
    return (
      <main className="main">
        <p>Too many requests. Please wait a minute and refresh.</p>
      </main>
    );
  const id = z
    .string()
    .cuid()
    .safeParse((await params).id);
  if (!id.success || process.env.GIVEAWAY_COVENANT_PROTOTYPE_ENABLED !== "true") notFound();
  const row = await prisma.covenantPrototype.findUnique({
    where: { id: id.data },
    include: {
      creator: { select: { username: true } },
      _count: { select: { registrations: true } },
    },
  });
  if (!row?.publicTitle) notFound();
  const m = prototypeManifestSchema.parse(row.manifest),
    terms = prototypeTerms(m);
  let available = false,
    status = "Chain status unavailable. Please refresh shortly.";
  try {
    const [chain, outputs] = await Promise.all([
      readPrototypeChain(),
      readPrototypeUtxos(terms.open.address),
    ]);
    const funded = outputs.some((u) => u.amount === terms.fundingSompi);
    available =
      funded &&
      chain.daa < BigInt(m.closesAtDaa) &&
      !row.entriesFrozenAt &&
      row._count.registrations < PUBLIC_COVENANT_LIMIT;
    status =
      chain.daa >= BigInt(m.closesAtDaa) || row.entriesFrozenAt
        ? "Entries closed"
        : row._count.registrations >= PUBLIC_COVENANT_LIMIT
          ? "Giveaway full"
          : funded
            ? `Entries close in approximately ${Math.max(1, Math.ceil(Number(BigInt(m.closesAtDaa) - chain.daa) / 600))} minutes`
            : "Waiting for creator funding";
  } catch {
    /* Fail closed when chain state is unavailable. */
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
  const payout = tx.success ? await readPrototypePayout(tx.data.transactionId, m) : null;
  return (
    <main className="main" style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px" }}>
      <section className="card">
        <p>Giveaway by @{row.creator.username}</p>
        <h1>{row.publicTitle}</h1>
        <h2>{formatSompiToKaspa(BigInt(m.prizeSompi))} KAS</h2>
        <p role="status">{payout?.confirmed ? "Winner paid · confirmed on Mainnet" : status}</p>
        <p>
          {row._count.registrations} / {PUBLIC_COVENANT_LIMIT} participants · One winner
        </p>
        {payout?.confirmed && (
          <p style={{ overflowWrap: "anywhere" }}>
            Winner: {payout.winnerAddress} ·{" "}
            <a
              href={`https://explorer.kaspa.org/txs/${payout.transactionId}`}
              target="_blank"
              rel="noreferrer"
            >
              View payout
            </a>
          </p>
        )}
        <EntryClient
          id={row.id}
          available={available && !payout?.confirmed && publicCovenantVerificationReady()}
          siteKey={process.env.TURNSTILE_SITE_KEY?.trim() ?? ""}
        />
        <details>
          <summary>Participation and draw rules</summary>
          <p>
            Free entry. One entry per Kaspa mainnet address. No wallet connection or payment is
            required. Your address is stored for this draw; the winning address and final
            transaction proof are public. Human verification discourages bots but does not establish
            one person per wallet. The creator closes the list and triggers the covenant payout. The
            platform attests the list and blockchain randomness. If the draw is not completed, the
            creator can recover the remaining prize after the refund deadline.
          </p>
        </details>
      </section>
    </main>
  );
}
