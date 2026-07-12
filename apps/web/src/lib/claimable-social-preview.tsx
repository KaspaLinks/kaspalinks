import { ImageResponse } from "next/og";

import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { SocialPreviewImage, socialPreviewImageSize } from "@/lib/social-preview-image";

export async function renderClaimableSocialPreview(linkKey: string): Promise<ImageResponse> {
  const normalizedKey = linkKey.trim();
  const claimableLink =
    normalizedKey && normalizedKey.length <= 128
      ? await prisma.claimableLink.findFirst({
          select: { amountSompi: true, feeSompi: true, status: true, title: true },
          where: { linkKey: normalizedKey },
        })
      : null;

  if (!claimableLink) {
    return new ImageResponse(
      <SocialPreviewImage
        amountLabel="First come, first served"
        eyebrow="Claimable Kaspa link"
        subtitle="Claim KAS directly to your own wallet. No account and no custody."
        title="You have Kaspa to claim"
        typeLabel="Claim KAS"
      />,
      socialPreviewImageSize,
    );
  }

  const netSompi = claimableLink.amountSompi - claimableLink.feeSompi;
  const amountKas = formatSompiToKaspa(
    netSompi > 0n ? netSompi : claimableLink.amountSompi,
  );
  const claimed = claimableLink.status === "claimed";
  const spentUnknown = claimableLink.status === "spent_unknown";
  const closed = claimed || spentUnknown;
  const expired = claimableLink.status === "refundable" || claimableLink.status === "refunded";

  return new ImageResponse(
    <SocialPreviewImage
      amountLabel={closed || expired ? null : `${amountKas} KAS`}
      eyebrow={
        claimed
          ? "Claim complete"
          : spentUnknown
            ? "Output already spent"
            : expired
              ? "Claim window expired"
              : "Claimable Kaspa link"
      }
      subtitle={
        claimed
          ? "This one-time Kaspa claim link has already been used."
          : spentUnknown
            ? "This funding output was spent outside a recorded Kaspa Links claim or refund."
            : expired
              ? "The claim window has ended and the creator can refund the unclaimed KAS."
              : "Claim directly to your own wallet. First come, first served — no account and no custody."
      }
      title={
        claimed
          ? "Already claimed"
          : spentUnknown
            ? "Already spent on-chain"
            : expired
              ? "Claim window expired"
              : claimableLink.title
      }
      typeLabel={closed || expired ? "Closed" : "Claim KAS"}
    />,
    socialPreviewImageSize,
  );
}
