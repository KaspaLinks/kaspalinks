import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@kaspa-actions/db";
import { buildKaspaPaymentUri, formatSompiToKaspa } from "@kaspa-actions/kaspa";

import {
  isActionDeleted,
  isActionDisabled,
  isActionExpired,
  serializePublicAction,
} from "@/lib/action-serializer";
import { loadGoalProgress } from "@/lib/goal-progress";
import { buildActionSocialPreview } from "@/lib/social-preview";

import { ActionPaymentFlow } from "./ActionPaymentFlow";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ publicId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
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
      publicId: true,
      title: true,
      type: true,
    },
    where: { publicId },
  });

  if (!action || isActionDeleted(action) || isActionDisabled(action) || isActionExpired(action)) {
    return {
      description: "This Kaspa Links payment link is no longer available.",
      robots: { follow: false, index: false },
      title: "Link unavailable",
    };
  }

  const preview = buildActionSocialPreview({
    amountKas: action.amountSompi !== null ? formatSompiToKaspa(action.amountSompi) : null,
    creatorDisplayName: action.creator?.displayName,
    creatorUsername: action.creator?.username,
    description: action.description,
    goalKas: action.goalSompi !== null ? formatSompiToKaspa(action.goalSompi) : null,
    title: action.title,
    type: action.type,
  });
  const path = `/a/${encodeURIComponent(action.publicId)}`;
  const imagePath = `${path}/opengraph-image`;

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
    title: preview.title,
    twitter: {
      card: "summary_large_image",
      description: preview.description,
      images: [imagePath],
      title: preview.title,
    },
  };
}

export default async function ActionPage({ params }: PageProps) {
  const { publicId } = await params;

  const action = await prisma.action.findUnique({ where: { publicId } });

  if (!action || isActionDeleted(action)) {
    notFound();
  }

  if (isActionDisabled(action)) {
    return (
      <main>
        <section className="card">
          <h1>Link disabled</h1>
          <p>This link is no longer available.</p>
          <p>
            <Link href="/">Back to home</Link>
          </p>
        </section>
      </main>
    );
  }

  if (isActionExpired(action)) {
    return (
      <main>
        <section className="card">
          <h1>Link expired</h1>
          <p>This link has expired and can no longer accept payments.</p>
          <p>
            <Link href="/">Back to home</Link>
          </p>
        </section>
      </main>
    );
  }

  const metadata = serializePublicAction(action);
  const paymentUri = buildKaspaPaymentUri({
    amountSompi: action.amountSompi ?? undefined,
    label: action.title,
    message: action.message,
    recipientAddress: action.recipientAddress,
  });
  const goalProgress = await loadGoalProgress(prisma, action);

  return (
    <ActionPaymentFlow action={metadata} goalProgress={goalProgress} paymentUri={paymentUri} />
  );
}
