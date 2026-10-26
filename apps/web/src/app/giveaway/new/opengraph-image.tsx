import { ImageResponse } from "next/og";

import { SocialPreviewImage, socialPreviewImageSize } from "@/lib/social-preview-image";

export const runtime = "nodejs";
export const alt = "Run your own Kaspa giveaway with Kaspa Links";
export const size = socialPreviewImageSize;
export const contentType = "image/png";

export default function GiveawayStudioOpenGraphImage() {
  return new ImageResponse(
    <SocialPreviewImage
      eyebrow="Kaspa giveaway"
      title="Run your own Kaspa giveaway"
      subtitle="Prize locked on-chain · winner paid automatically"
      typeLabel="Free to join"
      amountLabel="No account needed"
    />,
    size,
  );
}
