import type { Metadata } from "next";

import { prisma } from "@kaspa-actions/db";
import { formatSompiToKaspa } from "@kaspa-actions/kaspa";

import { CLAIMABLE_SOCIAL_PREVIEW_VERSION } from "@/lib/claimable-share";
import { ClaimableLinksShell } from "../toccata-lab/ClaimableLinksShell";
import type {
  ClaimableLabStatus,
  PublicClaimableLinkMetadata,
} from "../toccata-lab/ToccataLabClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ link?: string }>;
};

const FALLBACK_DESCRIPTION =
  "You received a first-come, non-custodial Kaspa claim link. Enter your own Kaspa address to claim it.";

// The claim code itself stays in the URL fragment. `link` is only a public,
// random link key used to give shared links a useful title, description and
// branded preview before the recipient opens the page.
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { link: linkKey } = (await searchParams) ?? {};
  const normalizedKey = typeof linkKey === "string" ? linkKey.trim() : "";
  const path = normalizedKey ? `/claim?link=${encodeURIComponent(normalizedKey)}` : "/claim";

  const fallback: Metadata = {
    alternates: { canonical: "/claim" },
    description: FALLBACK_DESCRIPTION,
    openGraph: {
      description: FALLBACK_DESCRIPTION,
      images: [
        {
          alt: "Claim Kaspa with Kaspa Links",
          height: 630,
          url: "/claim/opengraph-image",
          width: 1200,
        },
      ],
      title: "You have Kaspa to claim",
      type: "website",
      url: path,
    },
    robots: { follow: false, index: false },
    title: "Claim Kaspa",
    twitter: {
      card: "summary_large_image",
      description: FALLBACK_DESCRIPTION,
      images: ["/claim/opengraph-image"],
      title: "You have Kaspa to claim",
    },
  };

  if (!normalizedKey || normalizedKey.length > 128) return fallback;

  const claimableLink = await prisma.claimableLink.findFirst({
    select: { amountSompi: true, feeSompi: true, status: true, title: true },
    where: { linkKey: normalizedKey },
  });
  if (!claimableLink) return fallback;

  const netSompi = claimableLink.amountSompi - claimableLink.feeSompi;
  const amountKas = formatSompiToKaspa(netSompi > 0n ? netSompi : claimableLink.amountSompi);
  const claimed = claimableLink.status === "claimed";
  const spentUnknown = claimableLink.status === "spent_unknown";
  const expired = claimableLink.status === "refundable" || claimableLink.status === "refunded";
  const title = claimed
    ? "Claim already completed"
    : spentUnknown
      ? "Claimable output already spent"
      : expired
        ? "Claim window expired"
        : `${claimableLink.title} · Claim ${amountKas} KAS`;
  const description = claimed
    ? "This Kaspa claimable link has already been claimed and cannot be used again."
    : spentUnknown
      ? "This claimable output was spent on-chain outside a recorded Kaspa Links claim or refund."
      : expired
        ? "This Kaspa claimable link has expired. The creator can now refund the unclaimed KAS."
        : `Claim ${amountKas} KAS directly to your own wallet. First come, first served — no account or custody involved.`;
  const imagePath = `/claim/preview/v${CLAIMABLE_SOCIAL_PREVIEW_VERSION}/${encodeURIComponent(normalizedKey)}/opengraph-image`;

  return {
    ...fallback,
    description,
    openGraph: {
      description,
      images: [{ alt: title, height: 630, url: imagePath, width: 1200 }],
      title,
      type: "website",
      url: path,
    },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      images: [imagePath],
      title,
    },
  };
}

export default async function ClaimPage({ searchParams }: PageProps) {
  const { link: linkKey } = (await searchParams) ?? {};
  const normalizedKey = typeof linkKey === "string" ? linkKey.trim() : "";
  const initialPublicLink = await readPublicClaimableLink(normalizedKey);

  return <ClaimableLinksShell initialPublicLink={initialPublicLink} mode="claim" />;
}

async function readPublicClaimableLink(
  linkKey: string,
): Promise<PublicClaimableLinkMetadata | null> {
  if (!linkKey || linkKey.length > 128) return null;

  const link = await prisma.claimableLink.findFirst({
    select: {
      amountSompi: true,
      claimPublicKey: true,
      createdAt: true,
      description: true,
      feeSompi: true,
      fundingAddress: true,
      fundingOutputIndex: true,
      fundingTxId: true,
      linkKey: true,
      redeemScriptHex: true,
      refundLockTime: true,
      status: true,
      title: true,
    },
    where: { linkKey },
  });
  if (!link) return null;

  const netSompi = link.amountSompi - link.feeSompi;
  return {
    amountKas: formatSompiToKaspa(link.amountSompi),
    amountSompi: link.amountSompi.toString(),
    claimPublicKey: link.claimPublicKey,
    createdAt: link.createdAt.toISOString(),
    createdAtMs: link.createdAt.getTime(),
    description: link.description ?? "Claim this Kaspa link to your own mainnet address.",
    feeKas: formatSompiToKaspa(link.feeSompi),
    feeSompi: link.feeSompi.toString(),
    fundingAddress: link.fundingAddress,
    fundingMatch:
      link.fundingTxId !== null && link.fundingOutputIndex !== null
        ? {
            amountSompi: link.amountSompi.toString(),
            blockTime: null,
            outputIndex: link.fundingOutputIndex,
            transactionId: link.fundingTxId,
          }
        : null,
    id: link.linkKey,
    netClaimKas: formatSompiToKaspa(netSompi > 0n ? netSompi : link.amountSompi),
    redeemScriptHex: link.redeemScriptHex,
    refundLockTime: link.refundLockTime,
    status: normalizeClaimableStatus(link.status),
    title: link.title,
    validFor: `Until Kaspa DAA ${link.refundLockTime}`,
  };
}

function normalizeClaimableStatus(value: string): ClaimableLabStatus {
  if (
    value === "awaiting_funding" ||
    value === "funded" ||
    value === "shared" ||
    value === "claimed" ||
    value === "refundable" ||
    value === "refunded" ||
    value === "spent_unknown"
  ) {
    return value;
  }
  return "awaiting_funding";
}
