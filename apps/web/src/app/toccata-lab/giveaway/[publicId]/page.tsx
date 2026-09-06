import type { Metadata } from "next";

import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { buildGiveawaySocialPreview } from "@/lib/social-preview";
import { getGiveawayTurnstileClientConfig } from "@/lib/turnstile";

import { GiveawayEntryClient } from "./GiveawayEntryClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

const FALLBACK_DESCRIPTION =
  "Enter a non-custodial Kaspa giveaway. The prize is paid directly to the winning wallet.";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { publicId } = await params;
  const normalizedId = publicId.trim();
  const path = `/toccata-lab/giveaway/${encodeURIComponent(normalizedId)}`;
  const imagePath = `${path}/opengraph-image`;
  const giveaway =
    normalizedId && normalizedId.length <= 128
      ? await prisma.giveaway.findUnique({
          select: {
            amountSompi: true,
            closesAt: true,
            description: true,
            prizeLink: { select: { fundingTxId: true } },
            status: true,
            title: true,
          },
          where: { publicId: normalizedId },
        })
      : null;

  const preview = giveaway
    ? buildGiveawaySocialPreview({
        amountKas: formatSompiToKaspa(giveaway.amountSompi),
        closesAt: giveaway.closesAt,
        description: giveaway.description,
        prizeFunded: Boolean(giveaway.prizeLink?.fundingTxId),
        status: giveaway.status,
        title: giveaway.title,
      })
    : { description: FALLBACK_DESCRIPTION, title: "Kaspa giveaway" };

  return {
    alternates: { canonical: path },
    description: preview.description,
    openGraph: {
      description: preview.description,
      images: [{ alt: preview.title, height: 630, url: imagePath, width: 1200 }],
      title: preview.title,
      type: "website",
      url: path,
    },
    robots: { follow: false, index: false },
    title: preview.title,
    twitter: {
      card: "summary_large_image",
      description: preview.description,
      images: [imagePath],
      title: preview.title,
    },
  };
}

export default async function GiveawayEntryPage({ params }: PageProps) {
  const { publicId } = await params;
  return (
    <GiveawayEntryClient
      publicId={publicId}
      botUsername={process.env.TELEGRAM_BOT_USERNAME ?? ""}
      turnstile={getGiveawayTurnstileClientConfig()}
    />
  );
}
