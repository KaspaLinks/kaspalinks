import type { Metadata } from "next";
import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";
import { z } from "zod";

/** Public presentation only: never serialize the stored covenant manifest into a preview. */
export async function readGiveawayPreview(id: string) {
  const parsed = z.string().cuid().safeParse(id);
  if (!parsed.success || process.env.GIVEAWAY_COVENANT_PROTOTYPE_ENABLED !== "true") return null;
  const row = await prisma.covenantPrototype.findUnique({
    where: { id: parsed.data },
    select: { publicTitle: true, manifest: true, creator: { select: { username: true } } },
  });
  if (!row?.publicTitle) return null;
  const manifest = z
    .object({ prizeSompi: z.string().regex(/^[1-9][0-9]*$/) })
    .safeParse(row.manifest);
  if (!manifest.success) return null;
  return {
    title: row.publicTitle,
    username: row.creator.username,
    amount: `${formatSompiToKaspa(BigInt(manifest.data.prizeSompi))} KAS`,
  };
}

export async function giveawayMetadata(id: string): Promise<Metadata> {
  const preview = await readGiveawayPreview(id);
  if (!preview) return { title: "Giveaway unavailable", robots: { index: false, follow: false } };
  const path = `/giveaways/${encodeURIComponent(id)}`;
  const image = `${path}/opengraph-image`;
  const title = `Kaspa Giveaway · ${preview.amount} | ${preview.title}`;
  // Do not claim the prize is funded or entries are open: crawlers cache previews beyond closing.
  const description = `${preview.amount} prize · by @${preview.username}. Free entry · one winner. Open the giveaway to see participation and results.`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      title,
      description,
      url: path,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: `${preview.title} — Kaspa Giveaway — ${preview.amount} prize`,
        },
      ],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
