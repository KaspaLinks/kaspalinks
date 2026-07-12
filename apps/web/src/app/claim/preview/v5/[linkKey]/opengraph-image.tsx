import { renderClaimableSocialPreview } from "@/lib/claimable-social-preview";
import { socialPreviewImageSize } from "@/lib/social-preview-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Claim Kaspa with Kaspa Links";
export const size = socialPreviewImageSize;
export const contentType = "image/png";

type ImageProps = {
  params: Promise<{ linkKey: string }>;
};

export default async function ClaimLinkOpenGraphImage({ params }: ImageProps) {
  const { linkKey } = await params;
  return renderClaimableSocialPreview(linkKey);
}
