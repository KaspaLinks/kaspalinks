import { renderClaimableSocialPreview } from "@/lib/claimable-social-preview";
import { socialPreviewImageSize } from "@/lib/social-preview-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Claim Kaspa with Kaspa Links";
export const size = socialPreviewImageSize;
export const contentType = "image/png";

type ImageProps = {
  searchParams?: Promise<{ link?: string }>;
};

export default async function ClaimOpenGraphImage({ searchParams }: ImageProps) {
  const { link: linkKey } = (await searchParams) ?? {};
  return renderClaimableSocialPreview(typeof linkKey === "string" ? linkKey : "");
}
