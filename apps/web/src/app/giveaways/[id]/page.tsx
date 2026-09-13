import { giveawayMetadata } from "./preview";
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
import DrawProof from "./DrawProof";
import { giveawayV3Draw } from "@/lib/giveaway-prize-v3-proof";
import { prototypeEntropySchema } from "@/lib/giveaway-prize-v3-prototype";
import EntryClient from "./EntryClient";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return giveawayMetadata((await params).id);
}
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
  let drawWindowEnded = false;
  let closed = false;
  let funded = false;
  let available = false,
    status = "Chain status unavailable. Please refresh shortly.";
  try {
    const [chain, outputs] = await Promise.all([
      readPrototypeChain(),
      readPrototypeUtxos(terms.open.address),
    ]);
    funded = outputs.some((u) => u.amount === terms.fundingSompi);
    drawWindowEnded = chain.daa >= BigInt(m.refundDaa);
    closed = chain.daa >= BigInt(m.closesAtDaa) || Boolean(row.entriesFrozenAt);
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
  const entropy = prototypeEntropySchema.safeParse(row.entropy);
  const draw =
    entropy.success && m.entries.length
      ? giveawayV3Draw({
          seedHex: entropy.data.seedHex,
          sortedEntryHashes: m.entries.map((e) => e.hash),
        })
      : null;
  const winner = draw ? m.entries[draw.winnerIndex] : null;
  return (
    <main className="main giveaway-entry-page">
      <section className="giveaway-entry-hero">
        <span className="hero-eyebrow">Kaspa giveaway · @{row.creator.username}</span>
        <h1>{row.publicTitle}</h1>
        <div className="giveaway-hero-prize">
          <span className="label">Prize</span>
          <strong>{formatSompiToKaspa(BigInt(m.prizeSompi))} KAS</strong>
        </div>
      </section>
      <section className="card giveaway-entry-card">
        <div className="giveaway-entry-status" role="status">
          {payout?.confirmed
            ? "Completed · winner paid"
            : closed && row._count.registrations === 0
              ? "Ended · no participants"
              : closed
                ? drawWindowEnded
                  ? "Ended · payout not confirmed"
                  : "Entries closed · drawing"
                : status}
        </div>
        <div className="covenant-participant-count">
          <strong>{row._count.registrations}</strong>
          <span>
            participants <small>/ {PUBLIC_COVENANT_LIMIT}</small>
          </span>
          <span className="label">1 winner</span>
        </div>
        {payout?.confirmed ? (
          <div className="giveaway-result-state is-winner">
            <span className="label">Winner</span>
            <p className="covenant-winner-address">{payout.winnerAddress}</p>
            <a
              className="btn btn-primary"
              href={`https://explorer.kaspa.org/txs/${payout.transactionId}`}
              target="_blank"
              rel="noreferrer"
            >
              View confirmed payout
            </a>
          </div>
        ) : closed && row._count.registrations === 0 ? (
          <div className="giveaway-result-state">
            <h2>No winner this time</h2>
            <p>The creator can recover the prize under this giveaway's refund rules.</p>
          </div>
        ) : null}
        <EntryClient
          id={row.id}
          available={available && !payout?.confirmed && publicCovenantVerificationReady()}
          siteKey={process.env.TURNSTILE_SITE_KEY?.trim() ?? ""}
        />
        <div className="giveaway-entry-meta">
          <span>
            {funded ? "✓ Prize funded" : payout?.confirmed ? "✓ Paid on Mainnet" : "Mainnet"}
          </span>
          <span>Free entry · one address per entry</span>
        </div>
        {draw && winner && entropy.success && (
          <DrawProof
            proof={{
              version: m.version,
              entryHashes: m.entries.map((e) => e.hash),
              entriesRoot: draw.entriesRootHex,
              seedHex: entropy.data.seedHex,
              blockHash: entropy.data.blockHash,
              blockBlueScore: entropy.data.blockBlueScore,
              targetBlueScore: m.entropyTargetBlueScore,
              digest: draw.digestHex,
              winnerIndex: draw.winnerIndex,
              winnerScriptHex: winner.scriptPublicKeyHex,
              winnerAddress: winner.address,
            }}
          />
        )}
      </section>
      <details className="giveaway-proof">
        <summary>Rules & transparency</summary>
        <p>
          No payment or wallet connection is required. Your address is stored for the draw. Address
          hashes form the public draw proof; the winning address is public. Human verification does
          not guarantee one person per wallet.
        </p>
        <p>
          {m.version === 4
            ? "After closing, the server automatically freezes the list and submits the payout when the committed block is confirmed. An empty frozen list allows browser-signed recovery."
            : "This older giveaway uses creator-triggered freeze and draw, with its original refund deadline."}{" "}
          The platform attests the list and randomness block; SilverScript enforces the payout.
          Server or chain outages can delay processing.
        </p>
      </details>
      <p className="giveaway-entry-footnote">Non-custodial · powered by Kaspa</p>
    </main>
  );
}
