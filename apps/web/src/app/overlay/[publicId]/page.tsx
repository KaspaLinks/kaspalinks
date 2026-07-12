import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@kaspa-actions/db";
import { buildKaspaPaymentUri } from "@kaspa-actions/kaspa";

import {
  isActionDeleted,
  isActionDisabled,
  isActionExpired,
  serializePublicAction,
} from "@/lib/action-serializer";

import { OverlayView } from "./OverlayView";

export const dynamic = "force-dynamic";

type OverlayPageProps = {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ paymentRequestId?: string | string[] }>;
};

export default async function OverlayPage({ params, searchParams }: OverlayPageProps) {
  const { publicId } = await params;
  const query = await searchParams;

  const action = await prisma.action.findUnique({ where: { publicId } });

  if (!action || isActionDeleted(action)) {
    notFound();
  }

  if (isActionDisabled(action)) {
    return <OverlayUnavailable title="Link disabled" />;
  }

  if (isActionExpired(action)) {
    return <OverlayUnavailable title="Link expired" />;
  }

  const metadata = serializePublicAction(action);
  const paymentUri = buildKaspaPaymentUri({
    amountSompi: action.amountSompi ?? undefined,
    label: action.title,
    message: action.message,
    recipientAddress: action.recipientAddress,
  });

  return (
    <OverlayView
      action={metadata}
      actionUrl={`/a/${action.publicId}`}
      paymentRequestId={getSingleQueryValue(query.paymentRequestId)}
      paymentUri={paymentUri}
    />
  );
}

function OverlayUnavailable({ title }: { title: string }) {
  return (
    <main className="overlay-page">
      <section className="overlay-panel overlay-panel-unavailable">
        <h1>{title}</h1>
        <p>This Kaspa link is not available.</p>
        <Link href="/">Back to Kaspa Links</Link>
      </section>
    </main>
  );
}

function getSingleQueryValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  if (!raw) {
    return null;
  }

  const normalized = raw.trim();

  if (normalized.length === 0 || normalized.length > 128 || /[\s/]/.test(normalized)) {
    return null;
  }

  return normalized;
}
