import { headers } from "next/headers";
import { extractClientIp, hashClientIp } from "@/lib/client-ip";
import { enforceRateLimit, RateBuckets } from "@/lib/rate-limit-helpers";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { SocialPreviewImage, socialPreviewImageSize } from "@/lib/social-preview-image";
import { truncatePreviewText } from "@/lib/social-preview";
import { readGiveawayPreview } from "./preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const alt = "Kaspa Giveaway · prize and participation";
export const size = socialPreviewImageSize;
export const contentType = "image/png";

export default async function GiveawayOpenGraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const limited = enforceRateLimit(
    RateBuckets.TOCCATA_LAB_QR,
    hashClientIp(extractClientIp(await headers())),
  );
  if (!limited.allowed) return limited.response;
  const preview = await readGiveawayPreview((await params).id);
  if (!preview) notFound();
  return new ImageResponse(
    <SocialPreviewImage
      eyebrow="Kaspa Giveaway"
      title={truncatePreviewText(preview.title, 60)}
      subtitle="Free entry · one winner"
      handle={preview.username}
      amountLabel={`${preview.amount} prize`}
      typeLabel="Giveaway"
    />,
    size,
  );
}
