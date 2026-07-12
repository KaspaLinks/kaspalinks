import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

import { prisma } from "@kaspa-actions/db";

import { SocialPreviewImage, socialPreviewImageSize } from "@/lib/social-preview-image";
import { buildProfileSocialPreview, truncatePreviewText } from "@/lib/social-preview";

export const runtime = "nodejs";
export const alt = "Kaspa Links creator profile";
export const size = socialPreviewImageSize;
export const contentType = "image/png";

type ImageProps = {
  params: Promise<{ username: string }>;
};

export default async function ProfileOpenGraphImage({ params }: ImageProps) {
  const { username } = await params;
  const normalized = username.trim().toLowerCase();

  const creator = await prisma.creator.findUnique({
    select: { bio: true, displayName: true, username: true },
    where: { username: normalized },
  });

  if (!creator) {
    notFound();
  }

  const preview = buildProfileSocialPreview(creator);

  return new ImageResponse(
    <SocialPreviewImage
      eyebrow="Creator profile"
      handle={creator.username}
      subtitle={truncatePreviewText(preview.description, 132)}
      title={preview.title}
      typeLabel="Profile"
    />,
    size,
  );
}
