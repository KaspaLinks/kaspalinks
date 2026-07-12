import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { isActionDeleted, isActionDisabled, isActionExpired } from "@/lib/action-serializer";
import { SocialPreviewImage, socialPreviewImageSize } from "@/lib/social-preview-image";
import {
  actionTypeLabel,
  buildActionSocialPreview,
  truncatePreviewText,
} from "@/lib/social-preview";

export const runtime = "nodejs";
export const alt = "Kaspa Links payment link";
export const size = socialPreviewImageSize;
export const contentType = "image/png";

type ImageProps = {
  params: Promise<{ publicId: string }>;
};

export default async function ActionOpenGraphImage({ params }: ImageProps) {
  const { publicId } = await params;

  const action = await prisma.action.findUnique({
    select: {
      amountSompi: true,
      creator: { select: { displayName: true, username: true } },
      deletedAt: true,
      description: true,
      disabledAt: true,
      expiresAt: true,
      goalSompi: true,
      title: true,
      type: true,
    },
    where: { publicId },
  });

  if (!action || isActionDeleted(action) || isActionDisabled(action) || isActionExpired(action)) {
    notFound();
  }

  const amountLabel =
    action.goalSompi !== null
      ? `${formatSompiToKaspa(action.goalSompi)} KAS goal`
      : action.amountSompi !== null
        ? `${formatSompiToKaspa(action.amountSompi)} KAS`
        : "Any amount";
  const preview = buildActionSocialPreview({
    amountKas: action.amountSompi !== null ? formatSompiToKaspa(action.amountSompi) : null,
    creatorDisplayName: action.creator?.displayName,
    creatorUsername: action.creator?.username,
    description: action.description,
    goalKas: action.goalSompi !== null ? formatSompiToKaspa(action.goalSompi) : null,
    title: action.title,
    type: action.type,
  });

  return new ImageResponse(
    <SocialPreviewImage
      amountLabel={amountLabel}
      eyebrow="Kaspa payment link"
      handle={action.creator?.username}
      subtitle={truncatePreviewText(preview.description, 132)}
      title={preview.title}
      typeLabel={actionTypeLabel(action.type)}
    />,
    size,
  );
}
