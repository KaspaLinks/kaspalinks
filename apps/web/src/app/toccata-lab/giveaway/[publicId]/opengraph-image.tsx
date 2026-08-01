import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { buildGiveawaySocialPreview } from "@/lib/social-preview";
import { SocialPreviewImage, socialPreviewImageSize } from "@/lib/social-preview-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Kaspa Links giveaway";
export const size = socialPreviewImageSize;
export const contentType = "image/png";

type ImageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function GiveawayOpenGraphImage({ params }: ImageProps) {
  const { publicId } = await params;
  const normalizedId = publicId.trim();
  if (!normalizedId || normalizedId.length > 128) notFound();

  const giveaway = await prisma.giveaway.findUnique({
    select: {
      amountSompi: true,
      closesAt: true,
      description: true,
      prizeLink: { select: { fundingTxId: true } },
      status: true,
      title: true,
    },
    where: { publicId: normalizedId },
  });
  if (!giveaway) notFound();

  const amountKas = formatSompiToKaspa(giveaway.amountSompi);
  const preview = buildGiveawaySocialPreview({
    amountKas,
    closesAt: giveaway.closesAt,
    description: giveaway.description,
    prizeFunded: Boolean(giveaway.prizeLink?.fundingTxId),
    status: giveaway.status,
    title: giveaway.title,
  });

  return new ImageResponse(
    <SocialPreviewImage
      amountLabel={preview.amountLabel}
      eyebrow="Kaspa giveaway"
      subtitle={preview.description}
      title={giveaway.title}
      typeLabel={preview.typeLabel}
    />,
    size,
  );
}
